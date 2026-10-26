"""Microsoft Teams incoming webhooks (D-075): one plain-text message per notification."""

import httpx


async def post_message(http: httpx.AsyncClient, url: str, text: str) -> None:
    res = await http.post(url, json={"text": text})
    if res.status_code >= 400:
        raise RuntimeError(f"teams webhook {res.status_code}")
