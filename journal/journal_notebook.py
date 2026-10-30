"""Date views over the existing Markdown, with exact untouched-text preservation."""
import datetime as dt
import hashlib
import os
import re


def split(text):
    headings = []
    offset = 0
    fence = None
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        marker = re.match(r'(`{3,}|~{3,})', stripped)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
        elif fence is None:
            match = re.match(r'^## +(\d{4}-\d{2}-\d{2})(?:[ \t]+[^\r\n]*)?\r?\n?$', line)
            if match:
                try:
                    dt.date.fromisoformat(match[1])
                    headings.append((offset, offset + len(line), match[1]))
                except ValueError:
                    pass
        offset += len(line)
    sections = []
    if not headings or headings[0][0]:
        end = headings[0][0] if headings else len(text)
        sections.append({'key': 'undated', 'date': None, 'start': 0, 'end': end, 'text': text[:end]})
    counts = {}
    for i, (_, start, day) in enumerate(headings):
        counts[day] = counts.get(day, 0) + 1
        end = headings[i+1][0] if i+1 < len(headings) else len(text)
        sections.append({'key': f'{day}#{counts[day]}', 'date': day, 'start': start, 'end': end, 'text': text[start:end]})
    return sections


def snapshot(data):
    path = data / 'notebook.md'
    raw = path.read_bytes() if path.exists() else b''
    text = raw.decode('utf-8')
    return {'revision': hashlib.sha256(raw).hexdigest(), 'text': text,
            'sections': [{k:v for k,v in row.items() if k not in ('start','end')} for row in split(text)]}


def save_day(data, key, text, revision, base=None, existed=None):
    current = snapshot(data)
    original = current['text']
    section = next((row for row in split(original) if row['key'] == key), None)
    same_section = isinstance(base, str) and isinstance(existed, bool) and existed == bool(section) and base == (section['text'] if section else '')
    if revision != current['revision'] and not same_section:
        raise ValueError('本子这一天已在别处修改，草稿已保留。请复制草稿后重新读取。')
    newline = '\r\n' if '\r\n' in original else '\n'
    if section:
        if text == section['text']:
            return
        body = text
        if section['end'] < len(original) and body and not body.endswith('\n'):
            body += newline
        updated = original[:section['start']] + body + original[section['end']:]
    else:
        day = key.removesuffix('#1')
        if key != f'{day}#1' or dt.date.fromisoformat(day).isoformat() != day:
            raise ValueError('无效日期')
        if not text.strip():
            return
        updated = original + (newline if original and not original.endswith('\n') else '') + f'## {day}' + newline + text
    temp = data / '.notebook-day.tmp'
    temp.write_bytes(updated.encode('utf-8'))
    os.replace(temp, data / 'notebook.md')
