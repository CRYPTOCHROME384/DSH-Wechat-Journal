"""Fetch page metadata for sites that reject Node's TLS fingerprint.

The reading-inbox host plugin calls this as a fallback when its own fetch gets
a login wall or a site shell (Xiaohongshu redirects non-browser clients to
/login). Prints one JSON object on stdout.
"""

import json
import re
import sys

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
    )
    return text[:300]


def pick(pattern: str, html: str) -> str:
    match = re.search(pattern, html, re.I | re.S)
    return clean(match.group(1)) if match else ""


def main(url: str) -> None:
    try:
        resp = requests.get(
            url,
            headers={
                "user-agent": UA,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language": "zh-CN,zh;q=0.9",
            },
            timeout=20,
            allow_redirects=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=True))
        return
    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"
    html = resp.text

    title = pick(r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html)
    if not title:
        title = pick(r"<title[^>]*>(.*?)</title>", html)
    description = pick(
        r'<meta[^>]+(?:property|name)=["\'](?:og:)?description["\'][^>]+content=["\']([^"\']+)["\']',
        html,
    )
    print(
        json.dumps(
            {"title": title, "description": description, "finalUrl": resp.url, "status": resp.status_code},
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    # The parent process may not use a UTF-8 console; escaping keeps stdout safe.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing url"}, ensure_ascii=True))
    else:
        main(sys.argv[1])
