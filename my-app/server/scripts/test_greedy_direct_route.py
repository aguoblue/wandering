#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen


DEFAULT_PLAN = {
    "cityname": "深圳",
    "start": "深圳北站",
    "activities": [
        "莲花山公园",
        "深圳博物馆",
        "平安金融中心",
        "海上世界",
        "深圳湾公园",
    ],
}


@dataclass
class PoiPoint:
    query: str
    name: str
    address: str
    lng: float
    lat: float


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


def parse_location(location: str) -> tuple[float, float] | None:
    parts = [part.strip() for part in location.split(",")]
    if len(parts) != 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def search_first_poi(
    *,
    amap_key: str,
    keyword: str,
    cityname: str,
    sleep_seconds: float,
) -> PoiPoint | None:
    query = {
        "key": amap_key,
        "keywords": keyword,
        "region": cityname or "全国",
        "city_limit": "true" if cityname else "false",
        "page_size": 1,
    }
    url = f"https://restapi.amap.com/v5/place/text?{urlencode(query)}"
    print(f"[poi] {keyword} -> {mask_key(url)}")

    if sleep_seconds > 0:
        time.sleep(sleep_seconds)

    try:
        with urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        print(f"[warn] {keyword} 请求失败：{error}")
        return None

    if not isinstance(payload, dict) or str(payload.get("status", "")) != "1":
        print(f"[warn] {keyword} 高德返回异常：{payload.get('info') if isinstance(payload, dict) else payload}")
        return None

    pois = payload.get("pois")
    if not isinstance(pois, list) or not pois:
        print(f"[warn] {keyword} 未匹配到 POI")
        return None

    poi = pois[0]
    if not isinstance(poi, dict):
        return None

    location = parse_location(str(poi.get("location", "")))
    if location is None:
        print(f"[warn] {keyword} POI 坐标无效：{poi.get('location')}")
        return None

    lng, lat = location
    return PoiPoint(
        query=keyword,
        name=str(poi.get("name", "")).strip() or keyword,
        address=str(poi.get("address", "")).strip(),
        lng=lng,
        lat=lat,
    )


def direct_distance_meters(a: PoiPoint, b: PoiPoint) -> float:
    radius = 6371000
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    delta_lat = math.radians(b.lat - a.lat)
    delta_lng = math.radians(b.lng - a.lng)

    h = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(h))


def greedy_route(start: PoiPoint, activities: list[PoiPoint]) -> tuple[list[PoiPoint], list[float]]:
    current = start
    remaining = activities[:]
    ordered: list[PoiPoint] = []
    segment_distances: list[float] = []

    while remaining:
        next_point = min(remaining, key=lambda point: direct_distance_meters(current, point))
        segment_distances.append(direct_distance_meters(current, next_point))
        ordered.append(next_point)
        remaining.remove(next_point)
        current = next_point

    return ordered, segment_distances


def load_plan_from_args(args: argparse.Namespace) -> dict[str, Any]:
    if args.plan_file:
        raw = Path(args.plan_file).read_text(encoding="utf-8")
        plan = json.loads(raw)
        if not isinstance(plan, dict):
            raise SystemExit("--plan-file 内容必须是 JSON object")
        return plan

    if args.start and args.activities:
        return {
            "cityname": args.city,
            "start": args.start,
            "activities": args.activities,
        }

    return DEFAULT_PLAN


def normalize_activities(raw_activities: Any) -> list[str]:
    if not isinstance(raw_activities, list):
        return []

    activities: list[str] = []
    for item in raw_activities:
        if isinstance(item, str) and item.strip():
            activities.append(item.strip())
        elif isinstance(item, dict):
            title = item.get("title") or item.get("name") or item.get("query")
            if isinstance(title, str) and title.strip():
                activities.append(title.strip())
    return activities


def print_point(label: str, point: PoiPoint) -> None:
    address = f" | {point.address}" if point.address else ""
    print(f"{label} {point.name} ({point.lng:.6f},{point.lat:.6f}){address}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="测试：高德 POI 匹配坐标后，用直线距离贪心排序活动地点。"
    )
    parser.add_argument("--plan-file", help="AI 输出 JSON 文件，包含 cityname/start/activities")
    parser.add_argument("--city", default="", help="城市名，例如：深圳")
    parser.add_argument("--start", default="", help="出发点，例如：深圳北站")
    parser.add_argument("activities", nargs="*", help="活动地点列表")
    parser.add_argument("--sleep", type=float, default=0.25, help="每次高德请求前等待秒数，默认 0.25")
    args = parser.parse_args()

    plan = load_plan_from_args(args)
    cityname = str(plan.get("cityname") or plan.get("city") or args.city or "").strip()
    start_name = str(plan.get("start") or plan.get("origin") or args.start or "").strip()
    activity_names = normalize_activities(plan.get("activities"))

    if not cityname:
        raise SystemExit("缺少 cityname/city，请用 --city 或在 JSON 中提供 cityname")
    if not start_name:
        raise SystemExit("缺少 start，请用 --start 或在 JSON 中提供 start")
    if not activity_names:
        raise SystemExit("缺少 activities，请追加地点参数或在 JSON 中提供 activities")

    amap_key, key_source = get_amap_key()
    if not amap_key:
        raise SystemExit("未找到高德 key，请配置 AMAP_WEB_KEY/AMAP_KEY/VITE_AMAP_KEY")

    print(f"[key] {key_source}")
    print(f"[input] city={cityname} start={start_name} activities={len(activity_names)}")

    start_point = search_first_poi(
        amap_key=amap_key,
        keyword=start_name,
        cityname=cityname,
        sleep_seconds=args.sleep,
    )
    if start_point is None:
        raise SystemExit("出发点 POI 匹配失败，无法继续")

    activity_points: list[PoiPoint] = []
    unresolved: list[str] = []
    for activity_name in activity_names:
        point = search_first_poi(
            amap_key=amap_key,
            keyword=activity_name,
            cityname=cityname,
            sleep_seconds=args.sleep,
        )
        if point is None:
            unresolved.append(activity_name)
            continue
        activity_points.append(point)

    if not activity_points:
        raise SystemExit("所有活动地点都匹配失败，无法排序")

    ordered, segment_distances = greedy_route(start_point, activity_points)

    print("\n[matched]")
    print_point("start:", start_point)
    for index, point in enumerate(activity_points, start=1):
        print_point(f"{index:>2}.", point)

    if unresolved:
        print("\n[unresolved]")
        for name in unresolved:
            print(f"- {name}")

    print("\n[greedy direct route]")
    print_point(" 0.", start_point)
    total = 0.0
    for index, (point, distance) in enumerate(zip(ordered, segment_distances), start=1):
        total += distance
        print_point(f"{index:>2}.", point)
        print(f"     segment_direct_distance={distance / 1000:.2f}km")
    print(f"\n[total] direct_distance={total / 1000:.2f}km")


if __name__ == "__main__":
    main()
