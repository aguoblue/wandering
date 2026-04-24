#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen


API_URL = "https://api.pexels.com/v1/search"
DEFAULT_QUERY = "shenzhen travel cityscape"


def load_env_file() -> dict[str, str]:
    env_map: dict[str, str] = {}
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return env_map

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key.strip()] = value.strip().strip('"').strip("'")
    return env_map


def get_pexels_api_key() -> tuple[str, str]:
    env_map = load_env_file()
    candidates = [
        ("env:PEXELS_API_KEY", os.environ.get("PEXELS_API_KEY", "")),
        ("file:.env PEXELS_API_KEY", env_map.get("PEXELS_API_KEY", "")),
    ]
    for source, value in candidates:
        if value and value.strip():
            return value.strip(), source
    return "", "missing"


def search_pexels_image_url(
    *,
    api_key: str,
    query: str,
    per_page: int,
) -> dict[str, Any]:
    query_params = urlencode(
        {
            "query": query,
            "orientation": "landscape",
            "per_page": per_page,
            "page": 1,
        }
    )
    request = Request(
        f"{API_URL}?{query_params}",
        headers={
            "Authorization": api_key,
            "Accept": "application/json",
            # Some gateways may reject default Python urllib UA and return 403.
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=12) as response:
            body = response.read().decode("utf-8")
            payload = json.loads(body)
    except HTTPError as error:
        err_body = ""
        try:
            err_body = error.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = "<no response body>"
        raise RuntimeError(f"Pexels HTTP {error.code}: {err_body}") from error
    if not isinstance(payload, dict):
        return {}
    return payload


def pick_first_cover_url(payload: dict[str, Any]) -> str:
    photos = payload.get("photos")
    if not isinstance(photos, list) or not photos:
        return ""

    for item in photos:
        if not isinstance(item, dict):
            continue
        src = item.get("src")
        if not isinstance(src, dict):
            continue
        # Prefer large2x for better card/detail cover quality.
        url = src.get("large2x") or src.get("large") or src.get("original")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="测试 Pexels 图片封面抓取")
    parser.add_argument(
        "--query",
        default=DEFAULT_QUERY,
        help=f"搜索关键词，默认: {DEFAULT_QUERY}",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=5,
        help="候选图片数量，默认 5",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="输出原始 JSON（截断）用于调试",
    )
    return parser.parse_args()


def mask_key(key: str) -> str:
    if len(key) <= 10:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def main() -> None:
    args = parse_args()
    api_key, source = get_pexels_api_key()

    if not api_key:
        raise SystemExit(
            "未找到 PEXELS_API_KEY。请在 my-app/.env 或环境变量中配置后重试。"
        )

    print(f"[key] source={source} value={mask_key(api_key)}")
    print(f"[query] {args.query}")

    payload = search_pexels_image_url(
        api_key=api_key,
        query=args.query,
        per_page=max(1, min(args.per_page, 20)),
    )
    cover_url = pick_first_cover_url(payload)

    if cover_url:
        print("[ok] first_cover_url")
        print(cover_url)
    else:
        total = payload.get("total_results", 0)
        print(f"[fail] no image found, total_results={total}")

    if args.raw:
        raw = json.dumps(payload, ensure_ascii=False)
        print(f"[raw] {raw[:1200]}")


if __name__ == "__main__":
    main()
