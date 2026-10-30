"""Versioned source observations. Collection never asserts project progress."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import journal_notebook
import journal_sources
import journal_handoff
import uuid
from collections import Counter, defaultdict


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')


def collect(root, data, scan=False):
    records = data.setdefault('evidence', [])
    known = {r['id'] for r in records}
    def add(kind, locator, version, text, projects=(), title='', **extra):
        eid = 'e_' + digest(kind + '\n' + locator + '\n' + version)[:24]
        if eid in known:
            return
        # Old revisions stay available for audit, but must not keep asking for review.
        for old in records:
            if old['kind'] == kind and old['locator'] == locator and old['status'] == 'pending':
                old['status'] = 'superseded'
        quote = extra.get('suggested_quote','')
        start = max(0,text.find(quote)-500) if quote and text.find(quote)>15000 else 0
        records.append(dict(id=eid, kind=kind, locator=locator, version=version,
                            excerpt=text[start:start+16000], truncated=len(text)>16000,
                            projects=list(projects), title=title or locator,
                            at=now(), status='pending', **extra))
        known.add(eid)
    for section in journal_notebook.snapshot(root)['sections']:
        if section['text'].strip():
            add('notebook', 'notebook.md#' + section['key'], digest(section['text']),
                section['text'], title=section['date'] or '本子 · 未标日期')
    if scan:
        journal_sources.scan(root, {p['id'] for p in data['projects']})
    sources = journal_sources.status(root, content=True)
    for source in sources:
        for event in source.get('events', []):
            locator = str(Path(source['root']) / event['path'])
            add('file', locator, digest(json.dumps(event, sort_keys=True)),
                event['kind'] + '：' + event['path'] + ('\n' + event['excerpt'] if event.get('excerpt') else ''), sorted({s['id'] for s in sources if not s['id'].startswith('workspace:') and Path(locator).is_relative_to(Path(s['root']))}),
                title=event['path'], observed_at=event['at'], observation_only=not bool(event.get('excerpt')), partial=event.get('truncated',False))
    capture_files = sorted((root / 'capture').glob('*.jsonl')) if (root / 'capture').exists() else []
    if (root / 'capture.jsonl').exists():
        capture_files.insert(0, root / 'capture.jsonl')
    for path in capture_files:
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get('text') and row.get('ev'):
                add('wechat', str(path.relative_to(root))+'#'+row['ev'], digest(row['text']), row['text'], title=row.get('at','微信记录'), observed_at=row.get('at'))
    bridge = journal_handoff.read(root)
    for source in bridge:
        for entry in source.get('records',[]):
            if entry.get('review_required') is False:
                continue
            add('notion' if source['source']=='notion-library' else 'external',entry['url'],entry['version'],entry['text'],
                title=entry.get('title',entry['url']),partial=entry.get('partial',False),
                suggested_summary=entry.get('summary',''),suggested_quote=entry.get('quote',''),
                suggested_projects=entry.get('suggested_projects',[]),handoff_source=source['source'],
                source_updated_at=entry.get('source_updated_at'),change=entry.get('change'),
                observation_only=entry.get('observation_only',False))
    snapshot = {} if any(s['source']=='notion-library' and s.get('records') for s in bridge) else journal_sources.read_json(root / 'notion-snapshot.json', {})
    for page in snapshot.get('pages', []):
        add('notion', page['url'], digest(page['text']), page['text'],
            title=page.get('title', page['url']), source_edited_at=page.get('edited_at'),
            partial=page.get('partial', False), fetched_at=snapshot.get('fetched_at'))
    consolidate_files(data)
    return records


def consolidate_files(data):
    """Bundle pending file observations; retain originals and every source id."""
    groups = defaultdict(list)
    records = data.get('evidence', [])
    for record in records:
        if record.get('kind') != 'file' or record.get('status') != 'pending':
            continue
        title = record.get('title', '').replace('\\', '/')
        branch = title.split('/')[0] if '/' in title else '目录直属文件'
        day = (record.get('observed_at') or record.get('at', ''))[:10]
        # Unassigned directories must not be merged across the workspace.
        root = record.get('locator', '')[:-len(record.get('title',''))] if record.get('title') else record.get('locator','')
        key = (tuple(sorted(record.get('projects', []))), day, root, branch)
        groups[key].append(record)
    for (projects, day, root, branch), members in groups.items():
        if len(members) < 2:
            continue
        ids = sorted(r['id'] for r in members)
        version = digest('\n'.join(ids))
        eid = 'batch_' + version[:24]
        types = Counter(Path(r.get('title','')).suffix.lower() or '无扩展名' for r in members)
        folders = Counter(str(Path(r.get('title','')).parent) for r in members)
        headline = f'{day} · {branch}：{len(members)} 个文件发生变化'
        excerpt = headline + '\n\n文件类型：' + '、'.join(f'{ext} {count} 个' for ext,count in types.most_common())
        excerpt += '\n\n主要目录：\n' + '\n'.join(f'{folder} · {count} 个' for folder,count in folders.most_common(8))
        excerpt += '\n\n这里只记录文件变化，不代表实验成功或任务完成。'
        records.append(dict(id=eid,kind='file_batch',locator=root+branch+'#'+version[:12],version=version,
            excerpt=excerpt,title=headline,projects=list(projects),at=now(),observed_at=day,
            status='pending',observation_only=True,suggested_summary=headline,suggested_quote=headline,
            members=ids,member_count=len(ids)))
        for record in members:
            record.update(status='bundled',batch_id=eid)


def batch_context(data, record):
    if record.get('kind') != 'file_batch': return record
    members = [r for r in data['evidence'] if r['id'] in set(record.get('members', []))]
    candidates = [r for r in members if Path(r.get('title','')).suffix.lower() in ('.md','.txt') and not any(part in r.get('title','').replace('\\','/').lower().split('/') for part in ('vendor','node_modules','raw'))]
    candidates.sort(key=lambda r: (0 if Path(r['title']).name.lower()=='results.md' else 1,r['title']))
    return {**record,'summary_needed': not bool(record.get('findings')), 'reading_sources': [{k:r.get(k) for k in ('id','title','locator','version','excerpt','truncated')} for r in candidates[:12]], 'reading_source_total':len(candidates)}

def summarize_batch(data, payload):
    record = next((r for r in data['evidence'] if r['id']==payload.get('id')), None)
    if not record or record.get('kind')!='file_batch' or record['status'] not in ('pending','confirmed','ignored'):
        raise ValueError('批次已处理或不存在')
    if payload.get('version') != record['version']:
        raise ValueError('批次版本已变化')
    findings = payload.get('findings')
    if not isinstance(findings,list) or not 1 <= len(findings) <= 6:
        raise ValueError('请归纳 1 至 6 条有来源的重点')
    validated=[]
    for finding in findings:
        source=next((r for r in data['evidence'] if r['id']==finding.get('source_id') and r['id'] in record['members']),None)
        if not source or not isinstance(finding.get('quote'),str) or not finding['quote'].strip() or finding['quote'] not in source['excerpt']:
            raise ValueError('引用必须逐字存在于该批次的来源版本中')
        if not isinstance(finding.get('text'),str) or not 1 <= len(finding['text']) <= 600:
            raise ValueError('每条重点需在 600 字以内')
        validated.append({**finding,'locator':source['locator'],'source_version':source['version']})
    questions=[]
    summary=payload.get('summary') or '\n'.join(f['text'] for f in validated)
    if not isinstance(summary,str) or not summary.strip() or len(summary)>400: raise ValueError('请提供 400 字以内的简洁概述')
    if record['status'] != 'pending':
        child_id = 'summary_' + digest(record['id']+json.dumps(validated,ensure_ascii=False,sort_keys=True))[:24]
        if any(r['id']==child_id for r in data['evidence']): return {'ok':True,'unchanged':True}
        record = {k:v for k,v in record.items() if k not in ('review_revision','reviewed_at','summary','quote','state_updated','summary_history')}
        record.update(id=child_id,status='pending',parent_batch=payload['id'],at=now(),locator=record['locator']+'#summary')
        data['evidence'].append(record)
    record.setdefault('summary_history',[]).append({k:record.get(k) for k in ('suggested_summary','findings','questions','summarized_at')})
    record.update(findings=validated,questions=questions,suggested_summary=summary,summarized_at=now())
    # Quote remains actual source text, never the generated paraphrase.
    record['suggested_quote']=validated[0]['quote']
    original=record.get('inventory_excerpt',record['excerpt'])
    record['inventory_excerpt']=original
    record['excerpt']=original+'\n\n报告依据：\n'+'\n\n'.join(f['locator']+'\n'+f['quote'] for f in validated)
    return {'ok':True,'findings':len(validated),'questions':len(questions)}


def overview(root, data):
    snapshot = journal_sources.read_json(root / 'notion-snapshot.json', {})
    bridge=journal_handoff.status(root)
    notion=next((s for s in bridge if s['source']=='notion-library'),None)
    return {'records': data.get('evidence', []), 'workspace': journal_sources.read_json(root / 'sources.json', {}).get('workspace'),
            'schedule': journal_sources.read_json(root/'reports'/'schedule-migration-status.json', {'status':'pending' if (root/'schedule-migration.json').exists() else 'none'}),
            'handoff': bridge,
            'notion': {'mode':'handoff','count':notion['count'],'fetched_at':notion.get('checked_at'),'complete':notion.get('complete',False),
                       'error':notion.get('error'),'outcome':notion.get('outcome'),'stale':notion.get('stale'),'automatic':True} if notion else {'mode': 'snapshot' if snapshot else 'disconnected',
                       'fetched_at': snapshot.get('snapshot_at'), 'count': len(snapshot.get('pages', [])),
                       'complete': snapshot.get('complete', False),
                       'error': snapshot.get('error'), 'automatic': False}}


def decide(root, data, payload, project_fields, write_project_file):
    record = next((r for r in data.get('evidence', []) if r['id'] == payload.get('id')), None)
    if not record:
        raise ValueError('找不到来源记录，请先读取晚间上下文')
    decision = payload.get('decision')
    if decision not in ('confirmed', 'ignored'):
        raise ValueError('决定必须是 confirmed 或 ignored')
    if record['status'] == decision:
        return {'ok': True, 'unchanged': True, 'revision':record.get('review_revision')}
    if record['status'] != 'pending':
        raise ValueError('来源已被处理或有新版，请重新读取')
    if record['kind'] == 'notebook':
        section = next((s for s in journal_notebook.snapshot(root)['sections'] if 'notebook.md#'+s['key'] == record['locator']), None)
        if not section or digest(section['text']) != record['version']:
            raise ValueError('本子原文已变，请重新收集后核对')
    if decision == 'ignored':
        record.update(status=decision, reviewed_at=now(), review_revision=uuid.uuid4().hex)
        return {'ok': True, 'revision':record['review_revision']}
    ids = payload.get('projects', record['projects'])
    if not isinstance(ids, list) or not ids or any(not isinstance(i,str) for i in ids):
        raise ValueError('请明确关联至少一个项目')
    projects = [next((p for p in data['projects'] if p['id'] == pid), None) for pid in dict.fromkeys(ids)]
    if any(p is None for p in projects):
        raise ValueError('项目不存在，请重新选择')
    summary = payload.get('summary', '').strip()
    if not summary or len(summary) > 2000:
        raise ValueError('请填写 2000 字以内的进展说明')
    quote = payload.get('quote', '').strip()
    # A summary must point to literal evidence. Binary metadata can only be an observation.
    if not quote or quote not in record['excerpt']:
        raise ValueError('需要一段来源中确实存在的原文作为依据')
    if record.get('partial') and payload.get('automatic'):
        raise ValueError('文献正文不完整，需人工核对')
    if record.get('observation_only') and payload.get('state') is not None:
        raise ValueError('文件变动只能记录观察，不能据此覆盖项目结论')
    if payload.get('state') is not None and len(projects) != 1:
        raise ValueError('更新当前进展时必须指定单个项目')
    if payload.get('state') is not None:
        fields = project_fields(projects[0])
        if payload.get('expected_state') != fields['state']:
            raise ValueError('项目当前进展已变化，请重读后再更新')
        if not isinstance(payload['state'], str) or len(payload['state']) > 2000:
            raise ValueError('进展文字过长或格式错误')
        fields['state'] = payload['state']
        write_project_file(projects[0], fields)
    stamp = now()
    revision = uuid.uuid4().hex
    for project in projects:
        event = {'at': stamp, 'field': 'evidence', 'to': summary, 'evidence_id': record['id'],
                 'source': {'kind': record['kind'], 'locator': record['locator'], 'version': record['version'], 'quote': quote},
                 'confirmed_by': 'agent' if payload.get('automatic') else 'user'}
        event['review_revision'] = revision
        if record.get('findings'): event['sources'] = record['findings']
        project.setdefault('history', []).append(event)
        project['updated'] = stamp
    record.update(status='confirmed', projects=list(dict.fromkeys(ids)), summary=summary, quote=quote, reviewed_at=stamp,
                  review_revision=revision,state_updated=payload.get('state') is not None)
    return {'ok': True, 'id': record['id'], 'revision':revision}


def undo(data,payload):
    record=next((r for r in data.get('evidence',[]) if r['id']==payload.get('id')),None)
    if not record or record['status'] not in ('confirmed','ignored') or not payload.get('revision') or record.get('review_revision')!=payload['revision']:
        raise ValueError('记录已变化，无法撤销这一步，请重新核对')
    if record.get('state_updated'):
        raise ValueError('这条记录还更新了项目当前结论，请在项目详情核对后调整')
    if any(r['kind']==record['kind'] and r['locator']==record['locator'] for r in data['evidence'][data['evidence'].index(record)+1:]):
        raise ValueError('来源已有新版，请核对新版')
    stamp=now()
    for project in data['projects']:
        for event in project.get('history',[]):
            if event.get('review_revision')==payload['revision']:
                event.update(retracted=True,retracted_at=stamp)
    record.setdefault('review_history',[]).append({k:record.get(k) for k in ('status','summary','quote','reviewed_at','review_revision')})
    record.update(status='pending',review_revision=uuid.uuid4().hex)
    return {'ok':True}
