"""Read-only consumer of the external-source bridge."""
import datetime as dt
import json
from pathlib import Path


def read(root):
    config=root/'handoff.json'
    if not config.exists():
        return []
    base=Path(json.loads(config.read_text(encoding='utf-8-sig'))['root'])
    result=[]
    for path in sorted((base/'sources').glob('*.json')):
        try:
            payload=json.loads(path.read_text(encoding='utf-8-sig'))
            if payload.get('schema_version')!=1:
                raise ValueError('不支持的交接格式')
            stamp=dt.datetime.fromisoformat(payload['checked_at'].replace('Z','+00:00'))
            if stamp.tzinfo is None:
                raise ValueError('检查时间缺少时区')
            payload['stale']=(dt.datetime.now(dt.timezone.utc)-stamp).total_seconds()>36*3600
            result.append(payload)
        except (ValueError,KeyError,OSError) as error:
            result.append({'source':path.stem,'outcome':'error','error':str(error),'records':[],'stale':True})
    return result


def status(root):
    return [{k:v for k,v in row.items() if k not in ('records','changed_ids','missing_ids')} |
            {'count':len(row.get('records',[])),'changes':len(row.get('changed_ids',[])),'missing':len(row.get('missing_ids',[]))} for row in read(root)]
