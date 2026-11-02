"""Read-only project discovery. Only the journal's own index is written."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import stat

SKIP = {'node_modules', '__pycache__', 'python_deps', 'site-packages', 'venv',
        'env', 'tmp', 'temp', 'cache', 'mplconfig', 'dependencies'}
EXT = set('.md .txt .csv .tsv .json .jsonl .yaml .yml .py .r .m .ipynb .js .ts .sh .ps1 .png .jpg .jpeg .svg .pdf .docx .pptx .xlsx .npy .npz .mat .h5 .hdf5 .parquet .tif .tiff .pkl .pt .pth'.split())


def configured(data):
    config = read_json(data / 'sources.json', {'projects': []})
    entries = list(config.get('projects', []))
    workspace = config.get('workspace')
    if not workspace:
        return entries
    root = Path(workspace)
    if not root.is_dir():
        return entries + [{'id': 'workspace:unavailable', 'root': str(root)}]
    bound = {os.path.normcase(str(Path(p['root']).resolve())) for p in entries}
    excluded = {os.path.normcase(str(Path(p).resolve())) for p in config.get('exclude', [])}
    for child in sorted(root.iterdir()):
        key = os.path.normcase(str(child.resolve()))
        if child.name.startswith('.') or child.name.lower() in SKIP or 'recovery' in child.name.lower():
            continue
        if child.is_symlink() or getattr(child.lstat(), 'st_file_attributes', 0) & 1024:
            continue
        if child.is_dir() and key not in bound and key not in excluded:
            entries.append({'id': 'workspace:' + hashlib.sha256(key.encode()).hexdigest()[:12], 'root': str(child)})
    return entries


def source_key(entry):
    return entry['id'] + ':' + hashlib.sha256(os.path.normcase(str(Path(entry['root']).resolve())).encode()).hexdigest()[:16]

def previous_record(saved, entry):
    record = saved['projects'].get(source_key(entry), saved['projects'].get(entry['id'], {}))
    return record if record.get('root') == str(Path(entry['root']).resolve()) else {}

def browse(data, root=''):
    config = read_json(data / 'sources.json', {})
    home = Path.home().resolve()
    workspace = Path(config['workspace']).expanduser().resolve() if config.get('workspace') else None
    # Workspace config controls discovery, not which directories users can bind.
    base = workspace if workspace and workspace.is_dir() else home
    candidate = Path(root.strip()).expanduser() if root.strip() else base
    if not candidate.is_absolute():
        raise ValueError('请输入完整目录路径，或使用 ~ 表示用户目录')
    path = candidate.resolve()
    if not path.is_dir():
        raise ValueError('目录不存在或不可访问，请检查路径')
    children = []
    try:
        for child in sorted(path.iterdir(), key=lambda p: (p.name.casefold(), p.name)):
            if child.name.startswith('.') or child.name.lower() in SKIP:
                continue
            try:
                if child.is_dir() and not child.is_symlink() and not getattr(child.lstat(), 'st_file_attributes', 0) & 1024:
                    children.append({'name': child.name, 'root': str(child)})
            except OSError:
                continue
    except OSError as error:
        raise ValueError('无法读取此目录，请检查目录访问权限') from error
    shortcuts = []
    def shortcut(name, target):
        try:
            if target.is_dir() and not any(s['root'] == str(target) for s in shortcuts):
                shortcuts.append({'name': name, 'root': str(target)})
        except OSError:
            pass
    shortcut('用户目录', home)
    if workspace:
        shortcut('工作区', workspace)
    if os.name == 'nt':
        for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            shortcut(letter + ':', Path(letter + ':/'))
    else:
        shortcut('根目录', Path('/'))
        shortcut('外接磁盘', Path('/Volumes'))
    return {'root': str(path), 'parent': str(path.parent) if path != path.parent else None,
            'children': children, 'shortcuts': shortcuts}

def bind(data, pid, root, project_ids, remove=False):
    if pid not in project_ids:
        raise ValueError('项目不存在')
    path = Path(root).resolve()
    if not remove and (not path.is_dir() or path.is_symlink() or getattr(path.lstat(), 'st_file_attributes', 0) & 1024):
        raise ValueError('请选择存在的普通目录')
    config = read_json(data / 'sources.json', {'projects': []})
    config['projects'] = [p for p in config.get('projects', []) if not (p['id'] == pid and os.path.normcase(str(Path(p['root']).resolve())) == os.path.normcase(str(path)))]
    if not remove: config['projects'].append({'id': pid, 'root': str(path)})
    temp = data / 'sources-config.tmp'
    temp.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, data / 'sources.json')


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else default


def status(data, content=False):
    saved = read_json(data / 'sources-index.json', {'projects': {}})
    config = {'projects': configured(data)}
    result = [{**{k:v for k,v in previous_record(saved,p).items() if k != 'files'}, 'id':p['id'], 'key':source_key(p), 'root':p['root']} for p in config['projects']]
    if not content:
        for row in result:
            row['events'] = [{k:v for k,v in event.items() if k != 'excerpt'} for event in row.get('events', [])]
    return result


def scan(data, project_ids):
    config = {'projects': configured(data)}
    saved = read_json(data / 'sources-index.json', {'projects': {}})
    excluded = {os.path.normcase(str(Path(p).resolve())).removeprefix('\\\\?\\') for p in read_json(data / 'sources.json', {}).get('exclude', [])}
    stamp = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
    for project in config['projects']:
        pid = project['id']
        if pid not in project_ids and not pid.startswith('workspace:'):
            continue
        root = Path(project['root']).resolve()
        display_root = str(root)
        if os.name == 'nt' and not display_root.startswith('\\\\?\\'):
            root = Path('\\\\?\\UNC\\' + display_root[2:]) if display_root.startswith('\\\\') else Path('\\\\?\\' + display_root)
        old = previous_record(saved, project)
        record = {**old, 'root': display_root, 'checked_at': stamp}
        saved['projects'][source_key(project)] = record
        errors = []
        files = {}
        if not root.is_dir():
            record['error'] = '项目目录不可用，保留上次索引'
            continue
        def walk_error(error):
            errors.append(str(error))
        try:
            for folder, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
                allowed = []
                for name in dirs:
                    child = Path(folder) / name
                    if os.path.normcase(str(child.resolve())).removeprefix('\\\\?\\') in excluded:
                        continue
                    if name.startswith('.') or name.lower() in SKIP or 'recovery' in name.lower():
                        continue
                    meta = child.lstat()
                    if not (meta.st_mode & stat.S_IFLNK or getattr(meta, 'st_file_attributes', 0) & 1024):
                        allowed.append(name)
                dirs[:] = allowed
                for name in names:
                    path = Path(folder) / name
                    if name.startswith(('.', '~$')) or path.suffix.lower() not in EXT:
                        continue
                    info = path.lstat()
                    if path.is_symlink() or getattr(info, 'st_file_attributes', 0) & 1024:
                        continue
                    key = path.relative_to(root).as_posix()
                    fingerprint = {'size': info.st_size, 'mtime_ns': info.st_mtime_ns}
                    # Small text artifacts get a content hash; binary/raw data are never opened.
                    if path.suffix.lower() in {'.md', '.txt', '.py', '.r', '.m', '.json', '.csv', '.yaml', '.yml'} and info.st_size <= 262144:
                        fingerprint['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                    files[key] = fingerprint
                    if len(files) > 50000:
                        raise ValueError('文件超过 50000，需缩小配置目录；本次未更新基线')
        except (OSError, ValueError) as error:
            errors.append(str(error))
        if errors:
            record['error'] = '扫描未完成，保留上次索引：' + errors[0]
            continue
        record.pop('error', None)
        previous = old.get('files')
        if old.get('root') != display_root:
            previous = None
        events = []
        if previous is not None:
            for path, info in files.items():
                before = previous.get(path)
                changed = before != info
                if before and before.get('sha256') and info.get('sha256') == before['sha256']:
                    changed = False
                if changed:
                    event = {'path': path, 'kind': '新增' if before is None else '修改', 'at': stamp, 'size': info['size'], 'fingerprint': info}
                    if Path(path).suffix.lower() in {'.md','.txt','.csv','.py','.r','.m'} and info['size'] <= 262144:
                        try:
                            raw = (root / path).read_bytes()
                            if hashlib.sha256(raw).hexdigest() == info.get('sha256'):
                                event['excerpt'] = raw.decode('utf-8-sig')[:12000]
                                event['truncated'] = len(raw.decode('utf-8-sig')) > 12000
                        except (OSError, UnicodeError):
                            pass
                    events.append(event)
            for path in previous.keys() - files.keys():
                events.append({'path': path, 'kind': '移出或删除', 'at': stamp})
        history = old.get('events', []) + events if previous is not None else []
        record.update(files=files, count=len(files), scanned_at=stamp,
                      baseline_at=old.get('baseline_at', stamp) if previous is not None else stamp,
                      events=history[-2000:], omitted_events=old.get('omitted_events', 0) + max(0, len(history)-2000),
                      changed=len(events), baseline=previous is None)
    data.mkdir(parents=True, exist_ok=True)
    temp = data / 'sources-index.tmp'
    temp.write_text(json.dumps(saved, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, data / 'sources-index.json')
    return status(data)
