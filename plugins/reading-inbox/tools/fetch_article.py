"""Fetch a WeChat article (or any page) and dump its readable text.

Used when the built-in web_fetch hits WeChat's captcha wall: a plain request
with a desktop browser UA usually still returns the article body.
"""

import io
import re
import sys

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def fetch(url: str) -> str:
    resp = requests.get(
        url,
        headers={"user-agent": UA, "accept": "text/html,application/xhtml+xml", "accept-language": "zh-CN,zh;q=0.9"},
        timeout=25,
    )
    resp.raise_for_status()
    html = resp.text
    match = re.search(r'id="js_content"[^>]*>(.*)', html, re.S)
    segment = match.group(1) if match else html
    segment = re.split(r'<script', segment, maxsplit=1)[0]
    segment = re.sub(r"<style.*?</style>", "", segment, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", segment)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()
    title = re.search(r'var msg_title = .*?"(.*?)"', html)
    return (title.group(1) if title else "") + "\n\n" + text


if __name__ == "__main__":
    url = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "article.txt"
    body = fetch(url)
    io.open(out, "w", encoding="utf-8").write(body[:20000])
    print(f"saved {len(body)} chars to {out}")
