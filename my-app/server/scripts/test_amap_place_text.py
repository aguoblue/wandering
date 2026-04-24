#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen


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


def get_amap_key() -> tuple[str, str]:
    env_map = load_env_file()
    candidates = [
        ("env:AMAP_WEB_KEY", os.environ.get("AMAP_WEB_KEY", "")),
        ("env:AMAP_KEY", os.environ.get("AMAP_KEY", "")),
        ("file:.env AMAP_WEB_KEY", env_map.get("AMAP_WEB_KEY", "")),
        ("file:.env AMAP_KEY", env_map.get("AMAP_KEY", "")),
        ("env:VITE_AMAP_KEY", os.environ.get("VITE_AMAP_KEY", "")),
        ("file:.env VITE_AMAP_KEY", env_map.get("VITE_AMAP_KEY", "")),
    ]
    for source, value in candidates:
        if value and value.strip():
            return value.strip(), source
    return "", "missing"


def mask_key(url: str) -> str:
    return re.sub(r"key=[^&]+", "key=***", url)


def request_place_text(
    *,
    amap_key: str,
    keyword: str,
    region: str,
    city_limit: bool,
    page_size: int,
) -> dict[str, Any] | None:
    query = {
        "key": amap_key,
        "keywords": keyword,
        "region": region or "全国",
        "city_limit": "true" if city_limit else "false",
        "show_fields": "business",
        "page_size": page_size,
    }
    url = f"https://restapi.amap.com/v5/place/text?{urlencode(query)}"
    print(f"\n[request] {mask_key(url)}")
    try:
        with urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if isinstance(payload, dict):
            return payload
        return None
    except Exception as error:
        print(f"[error] request failed: {error}")
        return None


def print_payload_summary(payload: dict[str, Any], limit: int, show_raw: bool) -> None:
    status = str(payload.get("status", ""))
    info = str(payload.get("info", ""))
    infocode = str(payload.get("infocode", ""))
    pois = payload.get("pois") if isinstance(payload.get("pois"), list) else []
    print(f"[response] status={status} infocode={infocode} info={info} count={len(pois)}")

    for index, poi in enumerate(pois[:limit], start=1):
        name = str(poi.get("name", "")).strip()
        location = str(poi.get("location", "")).strip()
        address = str(poi.get("address", "")).strip()
        city = str(poi.get("cityname", "")).strip()
        district = str(poi.get("adname", "")).strip()
        poi_type = str(poi.get("type", "")).strip()
        print(f"{index}. {name}")
        print(f"   location={location} city={city} district={district}")
        print(f"   address={address}")
        print(f"   type={poi_type}")

    if show_raw:
        print("\n[raw]")
        print(json.dumps(payload, ensure_ascii=False, indent=2))


def run_once(
    *,
    keyword: str,
    region: str,
    page_size: int,
    limit: int,
    show_raw: bool,
    run_both_city_limit: bool,
    fixed_city_limit: bool,
) -> None:
    amap_key, key_source = get_amap_key()
    if not amap_key:
        print("未找到高德 key，请在 figma/.env 或环境变量里配置 AMAP_WEB_KEY/AMAP_KEY/VITE_AMAP_KEY")
        return

    print(f"\n[key] source={key_source}")
    print(f"[input] keyword={keyword} region={region or '全国'}")

    city_limits = [True, False] if run_both_city_limit else [fixed_city_limit]
    for city_limit in city_limits:
        print(f"\n--- city_limit={'true' if city_limit else 'false'} ---")
        payload = request_place_text(
            amap_key=amap_key,
            keyword=keyword,
            region=region,
            city_limit=city_limit,
            page_size=page_size,
        )
        if payload is None:
            continue
        print_payload_summary(payload, limit=limit, show_raw=show_raw)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="输入地名关键词，调用高德 place/text 并打印候选 POI。"
    )
    parser.add_argument("keyword", nargs="?", help="搜索关键词，例如: 人才公园夜景")
    parser.add_argument("--region", default="", help="区域/城市，例如: 深圳 或 新疆伊犁特克斯县")
    parser.add_argument("--page-size", type=int, default=20, help="返回条数，默认 20")
    parser.add_argument("--limit", type=int, default=8, help="最多打印多少条 POI，默认 8")
    parser.add_argument(
        "--city-limit",
        choices=["true", "false", "both"],
        default="both",
        help="是否限制在 region 内搜索，默认 both",
    )
    parser.add_argument("--raw", action="store_true", help="输出完整原始 JSON")
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="交互模式：可连续输入多个关键词，输入 q 退出",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_both = args.city_limit == "both"
    fixed_city_limit = args.city_limit == "true"

    if args.interactive:
        print("交互模式已开启，输入 q 退出。")
        while True:
            keyword = input("\n请输入关键词: ").strip()
            if keyword.lower() in {"q", "quit", "exit"}:
                print("已退出。")
                return
            if not keyword:
                continue
            run_once(
                keyword=keyword,
                region=args.region,
                page_size=args.page_size,
                limit=args.limit,
                show_raw=args.raw,
                run_both_city_limit=run_both,
                fixed_city_limit=fixed_city_limit,
            )
        return

    if not args.keyword:
        raise SystemExit("请提供关键词，或使用 --interactive")

    run_once(
        keyword=args.keyword,
        region=args.region,
        page_size=args.page_size,
        limit=args.limit,
        show_raw=args.raw,
        run_both_city_limit=run_both,
        fixed_city_limit=fixed_city_limit,
    )


if __name__ == "__main__":
    main()
