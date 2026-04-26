from __future__ import annotations

import json
import math
import os
import re
import time
import uuid
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import ai_server as legacy

TOOL_ROUTER_MAX_TOKENS = max(
    1024,
    int(os.environ.get("AI_SERVER_TOOL_MAX_TOKENS", "4096")),
)


TOOL_ROUTER_SYSTEM_PROMPT = """你是一个中文旅行规划助手。你可以直接回复，也可以调用后端工具。

工具选择规则：
- 当用户提供小红书、网页、攻略链接，并希望你读取/解读/参考它时，调用 fetch_xhs_note。
- 当用户要求生成旅行计划，且计划顺序不是来自用户/外部链接明确要求保留的顺序时，先调用 optimize_travel_plan_route 优化活动顺序，再调用 create_travel_plan。
- 当用户提供外部链接，但明确说“优化路线/路线更顺/少绕路/距离最短”时，也要先调用 optimize_travel_plan_route，再调用 create_travel_plan。
- 当用户明确要求生成旅行计划/行程/攻略，且不需要路线优化或已经完成 optimize_travel_plan_route 时，调用 create_travel_plan。
- 当上下文中存在 currentPlan/targetPlanId，且用户要求增删改当前计划时，也调用 create_travel_plan，传入“修改后的完整 TravelPlan”，不要只用文字确认。
- 当用户只是询问、解释、评价、闲聊时，直接 reply。

fetch_xhs_note arguments：
{
  "url": "需要抓取的链接"
}

create_travel_plan arguments：
{
  "cityname": "目的地城市中文名，仅支持城市级别，例如“深圳”“深圳市”“杭州”“杭州市”。不要填写省份、区县、adcode 或英文。",
  "targetPlanId": "可选。修改当前计划时填写上下文里的 targetPlanId；新建计划时不要填写。",
  "plan": {
    "id": "新建时可临时填写，后端会重写为唯一 ID；修改当前计划时必须填写 targetPlanId",
    "name": "计划名称",
    "tags": ["标签"],
    "duration": "2天1晚",
    "highlight": "亮点",
    "walkingIntensity": "低/中/高，或更详细说明",
    "image": "可为空，后端会补封面",
    "destination": "目的地城市",
    "days": [
      {
        "day": 1,
        "date": "YYYY-MM-DD",
        "activities": [
          {
            "id": "1-1",
            "time": "09:00-11:00",
            "period": "上午",
            "title": "城市+具体 POI 名称",
            "description": "活动描述",
            "reason": "推荐理由",
            "duration": "2小时",
            "transport": "交通建议",
            "alternatives": ["备选地点"],
            "coordinates": [经度, 纬度]
          }
        ]
      }
    ]
  }
}

optimize_travel_plan_route arguments：
{
  "cityname": "目的地城市中文名，仅支持城市级别，例如“深圳”“杭州”。",
  "targetPlanId": "可选。修改当前计划时填写上下文里的 targetPlanId；新建计划时不要填写。",
  "plan": "完整 TravelPlan JSON，结构同 create_travel_plan。工具会用高德 POI 替换 coordinates，并在每天内部以第一个活动为出发点，用直线距离贪心重排后续活动。"
}

重要：
- 不要调用不存在的工具。
- 如果用户想基于链接生成计划，请先调用 fetch_xhs_note 读取链接内容，再基于工具结果继续回复。
- 如果用户说“按原顺序/照着链接顺序/不要改路线/复刻攻略”，不要调用 optimize_travel_plan_route。
- 如果调用了 optimize_travel_plan_route，后续 create_travel_plan 必须使用它返回的 plan，不要再使用优化前的 plan。
- 生成计划时，plan 必须是完整 TravelPlan；cityname 必须填写中文城市名，仅支持城市级别。
- 修改当前计划时，plan 必须是修改后的完整 TravelPlan，必须保留未要求修改的内容，plan.id 必须等于 targetPlanId。
- create_travel_plan 成功后，你需要根据工具返回的 plan 用自然中文简短告知用户计划已生成，不要再输出 JSON。
- 直接回复时使用自然中文，不要输出 JSON。
"""

ANTHROPIC_TOOLS: list[dict[str, Any]] = [
    {
        "name": "fetch_xhs_note",
        "description": "抓取小红书或网页链接的公开标题、描述和页面中可见的正文线索，用于解读攻略或作为生成路线的参考。",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "用户提供的 http/https 链接。",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "create_travel_plan",
        "description": "把模型生成的 TravelPlan JSON 发布为正式计划；后端会校验结构，并用高德 POI 搜索第一条结果替换活动坐标。",
        "input_schema": {
            "type": "object",
            "properties": {
                "cityname": {
                    "type": "string",
                    "description": "目的地城市中文名，仅支持城市级别，例如“深圳”“深圳市”“杭州”“杭州市”。不要填写省份、区县、adcode 或英文。",
                },
                "plan": {
                    "type": "object",
                    "description": "完整 TravelPlan JSON。活动 coordinates 使用 [经度, 纬度]，后端会用高德 POI 第一条结果覆盖。",
                },
                "targetPlanId": {
                    "type": "string",
                    "description": "可选。修改当前计划时传入旧计划 ID；新建计划时留空。",
                },
            },
            "required": ["cityname", "plan"],
        },
    },
    {
        "name": "optimize_travel_plan_route",
        "description": "接收完整 TravelPlan JSON，先用高德 POI 搜索第一条结果替换活动坐标，再以每天第一个活动为出发点，用直线距离贪心算法重排当天后续活动。",
        "input_schema": {
            "type": "object",
            "properties": {
                "cityname": {
                    "type": "string",
                    "description": "目的地城市中文名，仅支持城市级别，例如“深圳”“深圳市”“杭州”“杭州市”。",
                },
                "plan": {
                    "type": "object",
                    "description": "完整 TravelPlan JSON。每天 activities[0] 会作为当天出发点保留，其余活动按距离贪心排序。",
                },
                "targetPlanId": {
                    "type": "string",
                    "description": "可选。修改当前计划时传入旧计划 ID；新建计划时留空。",
                },
            },
            "required": ["cityname", "plan"],
        },
    },
]


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def sse_payload(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def compact_log_text(value: Any, limit: int = 6000) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...<truncated {len(text) - limit} chars>"


def block_value(block: Any, key: str, default: Any = None) -> Any:
    if isinstance(block, dict):
        return block.get(key, default)
    return getattr(block, key, default)


def content_blocks_to_message_param(blocks: Any) -> list[dict[str, Any]]:
    params: list[dict[str, Any]] = []
    for block in blocks or []:
        block_type = block_value(block, "type", "")
        if block_type == "text":
            params.append({"type": "text", "text": str(block_value(block, "text", ""))})
        elif block_type == "tool_use":
            params.append(
                {
                    "type": "tool_use",
                    "id": str(block_value(block, "id", "")),
                    "name": str(block_value(block, "name", "")),
                    "input": block_value(block, "input", {}) or {},
                }
            )
    return params


def collect_tool_uses(blocks: Any) -> list[dict[str, Any]]:
    tool_uses: list[dict[str, Any]] = []
    for block in blocks or []:
        if block_value(block, "type", "") == "tool_use":
            tool_uses.append(
                {
                    "id": str(block_value(block, "id", "")),
                    "name": str(block_value(block, "name", "")),
                    "input": block_value(block, "input", {}) or {},
                }
            )
    return tool_uses


def collect_text_blocks(blocks: Any) -> str:
    parts: list[str] = []
    for block in blocks or []:
        if block_value(block, "type", "") == "text":
            parts.append(str(block_value(block, "text", "")))
    return "".join(parts).strip()


def summarize_anthropic_response(response: Any) -> dict[str, Any]:
    return {
        "id": getattr(response, "id", ""),
        "type": getattr(response, "type", ""),
        "role": getattr(response, "role", ""),
        "model": getattr(response, "model", ""),
        "stopReason": getattr(response, "stop_reason", ""),
        "usage": getattr(response, "usage", None),
        "content": content_blocks_to_message_param(getattr(response, "content", [])),
    }


def request_anthropic_with_tools(messages: list[dict[str, Any]]) -> Any:
    client = legacy.Anthropic(api_key=legacy.API_KEY, base_url=legacy.BASE_URL)
    return client.messages.create(
        model=legacy.MODEL_NAME,
        max_tokens=TOOL_ROUTER_MAX_TOKENS,
        temperature=0,
        system=TOOL_ROUTER_SYSTEM_PROMPT,
        messages=messages,
        tools=ANTHROPIC_TOOLS,
        tool_choice={"type": "auto"},
    )


def build_tool_history_messages(
    connection: Any,
    conversation_id: str,
    limit: int = 24,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT role, kind, content
        FROM messages
        WHERE conversation_id = ? AND TRIM(content) <> ''
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (conversation_id, limit),
    ).fetchall()

    messages: list[dict[str, Any]] = []
    for row in reversed(rows):
        role = str(row["role"])
        kind = str(row["kind"] if "kind" in row.keys() else "chat")
        content = str(row["content"])
        if kind in {"tool_use", "tool_result"}:
            parsed_content = legacy.parse_json_or_default(content, content)
            messages.append({"role": role, "content": parsed_content})
        else:
            messages.append({"role": role, "content": content})
    return messages


def insert_hidden_tool_event(
    *,
    conversation_id: str,
    role: str,
    kind: str,
    content: Any,
) -> None:
    with legacy.get_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO messages (id, conversation_id, role, kind, visible, content, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """,
            (
                f"msg_{uuid.uuid4().hex}",
                conversation_id,
                role,
                kind,
                json.dumps(content, ensure_ascii=False),
                legacy.now_ms(),
            ),
        )


def build_model_messages(
    *,
    connection: Any,
    conversation_id: str,
    user_message: str,
    current_plan: dict[str, Any] | None,
    target_plan_id: str,
    plan_context: str,
) -> list[dict[str, Any]]:
    messages = build_tool_history_messages(connection, conversation_id)
    context_blocks: list[str] = []
    if plan_context:
        context_blocks.append(f"当前计划摘要：{plan_context[:12000]}")
    if current_plan:
        context_blocks.append(
            "currentPlan JSON（当前计划事实来源）："
            f"{json.dumps(current_plan, ensure_ascii=False)}"
        )
    if target_plan_id and current_plan:
        context_blocks.append(
            "工具调用要求：如果用户要求增删改当前计划，必须调用 create_travel_plan，"
            f"传入修改后的完整 TravelPlan，并设置 targetPlanId={target_plan_id}、plan.id={target_plan_id}。"
            "不要只用文字声称已修改。"
        )
    if context_blocks:
        context_message = {
            "role": "user",
            "content": "\n\n".join(context_blocks),
        }
        return [context_message, *messages[-23:]]
    return messages[-24:]


def fetch_xhs_note(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("链接格式不正确")

    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        },
        method="GET",
    )
    with urlopen(request, timeout=12) as response:
        html = response.read().decode("utf-8", errors="replace")
        final_url = response.geturl()
        status = response.status

    title = pick_first(
        get_meta(html, "property", "og:title"),
        get_meta(html, "name", "twitter:title"),
        get_title(html),
    )
    description = pick_first(
        get_meta(html, "name", "description"),
        get_meta(html, "property", "og:description"),
        get_meta(html, "name", "twitter:description"),
    )
    hints = get_embedded_text_hints(html)
    return {
        "inputUrl": url,
        "finalUrl": final_url,
        "status": status,
        "title": title,
        "description": description,
        "textHints": hints[:12],
    }


def mask_amap_params(params: dict[str, Any]) -> dict[str, Any]:
    masked = dict(params)
    if masked.get("key"):
        masked["key"] = "***"
    return masked


def normalize_cityname(cityname: Any) -> str:
    city_text = str(cityname or "").strip()
    if not city_text:
        raise ValueError("cityname 不能为空")
    if re.fullmatch(r"\d+", city_text):
        raise ValueError("cityname 需要填写中文城市名，不要填写 adcode")
    if re.search(r"[A-Za-z]", city_text):
        raise ValueError("cityname 仅支持中文城市名")
    if not re.fullmatch(r"[\u4e00-\u9fff]{2,12}", city_text):
        raise ValueError("cityname 仅支持 2-12 个中文字符")
    if city_text.endswith(("省", "自治区")):
        raise ValueError("cityname 仅支持城市级别，不要填写省份")
    if city_text.endswith(("区", "县", "镇", "乡", "街道")):
        raise ValueError("cityname 仅支持城市级别，不要填写区县或街镇")
    return city_text


def activity_search_keyword(destination: str, activity: dict[str, Any]) -> str:
    title = str(activity.get("title", "")).strip()
    cleaned_title = legacy.clean_activity_keyword(title)
    keyword = cleaned_title or title
    if not keyword:
        description = str(activity.get("description", "")).strip()
        keyword = re.split(r"[，。,；;]", description)[0].strip()
    if not keyword:
        return ""
    return legacy.compose_destination_keyword(destination, keyword)


def is_departure_activity(activity: dict[str, Any], index: int) -> bool:
    title = str(activity.get("title", "")).strip()
    description = str(activity.get("description", "")).strip()
    reason = str(activity.get("reason", "")).strip()
    combined = f"{title} {description} {reason}"
    if index == 0 and re.search(r"(出发|集合|起点|始发|交通枢纽)", combined):
        return True
    if index == 0 and re.search(r"(站|机场|火车站|高铁站|客运站|码头)$", title):
        return True
    return False


def normalize_activity_titles_for_tool_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(plan, ensure_ascii=False))


def title_without_location_prefix(title: str) -> str:
    title_text = str(title or "").strip()
    if "·" not in title_text:
        return title_text
    parts = [part.strip() for part in title_text.split("·") if part.strip()]
    return parts[-1] if parts else title_text


def title_with_adname_prefix(title: str, poi: dict[str, Any]) -> str:
    adname = str(poi.get("adname", "")).strip()
    base_title = title_without_location_prefix(title)
    if not adname or not base_title or base_title.startswith(adname):
        return base_title or title
    return f"{adname}·{base_title}"


def activity_keyword_destination(
    *,
    plan_destination: str,
    cityname: str,
    activity: dict[str, Any],
    index: int,
) -> str:
    if is_departure_activity(activity, index):
        return cityname
    return plan_destination


def search_first_amap_poi(
    *,
    amap_key: str,
    cityname: str,
    keyword: str,
) -> dict[str, Any] | None:
    params = {
        "key": amap_key,
        "keywords": keyword,
        "region": cityname,
        "city_limit": "true",
        "show_fields": "business",
        "page_size": 1,
    }
    legacy.logger.info(
        "create_travel_plan amap request params | params=%s",
        compact_log_text(mask_amap_params(params), 4000),
    )
    url = f"https://restapi.amap.com/v5/place/text?{urlencode(params)}"
    payload = legacy.request_amap_json(url)
    legacy.logger.info(
        "create_travel_plan amap response | keyword=%s | region=%s | payload=%s",
        keyword,
        cityname,
        compact_log_text(payload, 12000),
    )
    if not isinstance(payload, dict):
        return None
    pois = payload.get("pois")
    if not isinstance(pois, list) or not pois:
        return None
    first_poi = pois[0]
    return first_poi if isinstance(first_poi, dict) else None


def enrich_plan_coordinates_with_first_poi(
    *,
    plan: dict[str, Any],
    cityname: str,
) -> tuple[dict[str, Any], list[str]]:
    amap_key = legacy.get_amap_key()
    if not amap_key:
        raise ValueError("未找到高德 Web 服务 Key，请配置 AMAP_WEB_KEY 或 AMAP_KEY")

    next_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    destination = str(next_plan.get("destination", "")).strip()
    warnings: list[str] = []
    resolved_count = 0

    for day in next_plan.get("days", []):
        activities = day.get("activities") if isinstance(day, dict) else None
        if not isinstance(activities, list):
            continue
        for index, activity in enumerate(activities):
            if not isinstance(activity, dict):
                continue
            title = str(activity.get("title", "")).strip()
            keyword_destination = activity_keyword_destination(
                plan_destination=destination,
                cityname=cityname,
                activity=activity,
                index=index,
            )
            keyword = activity_search_keyword(keyword_destination, activity)
            if not keyword:
                warnings.append(f"{title or '未命名活动'} 缺少可搜索关键词，保留原坐标")
                continue

            poi = search_first_amap_poi(amap_key=amap_key, cityname=cityname, keyword=keyword)
            if not poi:
                warnings.append(f"{title or keyword} 未搜索到高德 POI，保留原坐标")
                continue

            parsed_location = legacy.parse_amap_location(poi.get("location"))
            if not parsed_location:
                warnings.append(f"{title or keyword} 的高德 POI 缺少有效 location，保留原坐标")
                continue

            activity["coordinates"] = [parsed_location[0], parsed_location[1]]
            activity["title"] = title_with_adname_prefix(title, poi)
            resolved_count += 1
            legacy.logger.info(
                "create_travel_plan coordinate replaced | title=%s | display_title=%s | keyword=%s | poi=%s | adname=%s | lng=%s | lat=%s",
                title,
                str(activity.get("title", "")),
                keyword,
                str(poi.get("name", "")).strip(),
                str(poi.get("adname", "")).strip(),
                parsed_location[0],
                parsed_location[1],
            )

    legacy.logger.info(
        "create_travel_plan coordinate enrichment done | plan_id=%s | region=%s | resolved=%s | warnings=%s",
        str(next_plan.get("id", "")),
        cityname,
        resolved_count,
        compact_log_text(warnings, 4000),
    )
    return next_plan, warnings


def activity_coordinates(activity: dict[str, Any]) -> tuple[float, float] | None:
    coordinates = activity.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    try:
        lng = float(coordinates[0])
        lat = float(coordinates[1])
    except (TypeError, ValueError):
        return None
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return None
    return lng, lat


def direct_distance_meters(
    from_activity: dict[str, Any],
    to_activity: dict[str, Any],
) -> float:
    from_coordinates = activity_coordinates(from_activity)
    to_coordinates = activity_coordinates(to_activity)
    if not from_coordinates or not to_coordinates:
        return float("inf")

    from_lng, from_lat = from_coordinates
    to_lng, to_lat = to_coordinates
    earth_radius_meters = 6371000
    lat1 = math.radians(from_lat)
    lat2 = math.radians(to_lat)
    delta_lat = math.radians(to_lat - from_lat)
    delta_lng = math.radians(to_lng - from_lng)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * earth_radius_meters * math.asin(math.sqrt(haversine))


def optimize_day_activities_by_direct_distance(
    activities: list[Any],
) -> tuple[list[Any], list[dict[str, Any]]]:
    if len(activities) <= 2:
        return activities, []
    if not isinstance(activities[0], dict) or not activity_coordinates(activities[0]):
        return activities, [
            {
                "reason": "first_activity_has_no_coordinates",
                "message": "当天第一个活动缺少有效坐标，保留原顺序",
            }
        ]

    ordered: list[Any] = [activities[0]]
    remaining = activities[1:]
    segments: list[dict[str, Any]] = []

    while remaining:
        current = ordered[-1]
        best_index = -1
        best_distance = float("inf")
        for index, candidate in enumerate(remaining):
            if not isinstance(candidate, dict):
                continue
            distance = direct_distance_meters(current, candidate)
            if distance < best_distance:
                best_index = index
                best_distance = distance

        if best_index < 0 or math.isinf(best_distance):
            ordered.extend(remaining)
            segments.append(
                {
                    "reason": "remaining_activity_has_no_coordinates",
                    "message": "部分活动缺少有效坐标，剩余活动保留原相对顺序",
                }
            )
            break

        next_activity = remaining.pop(best_index)
        ordered.append(next_activity)
        segments.append(
            {
                "from": str(current.get("title", "")).strip(),
                "to": str(next_activity.get("title", "")).strip(),
                "directDistanceMeters": round(best_distance),
            }
        )

    return ordered, segments


def optimize_plan_route_by_direct_distance(plan: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    next_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    route_summaries: list[dict[str, Any]] = []

    for day in next_plan.get("days", []):
        if not isinstance(day, dict):
            continue
        activities = day.get("activities")
        if not isinstance(activities, list) or len(activities) <= 2:
            continue

        original_titles = [
            str(activity.get("title", "")).strip()
            for activity in activities
            if isinstance(activity, dict)
        ]
        ordered_activities, segments = optimize_day_activities_by_direct_distance(activities)
        day["activities"] = ordered_activities
        optimized_titles = [
            str(activity.get("title", "")).strip()
            for activity in ordered_activities
            if isinstance(activity, dict)
        ]
        route_summaries.append(
            {
                "day": day.get("day"),
                "start": optimized_titles[0] if optimized_titles else "",
                "originalOrder": original_titles,
                "optimizedOrder": optimized_titles,
                "segments": segments,
            }
        )

    return next_plan, route_summaries


def optimize_travel_plan_route(
    cityname: str,
    plan: dict[str, Any],
    targetPlanId: str | None = None,
) -> dict[str, Any]:
    target_plan_id = str(targetPlanId or "").strip()
    legacy.logger.info(
        "optimize_travel_plan_route tool input | input=%s",
        compact_log_text({"cityname": cityname, "targetPlanId": target_plan_id, "plan": plan}, 12000),
    )
    normalized_cityname = normalize_cityname(cityname)
    if not isinstance(plan, dict):
        raise ValueError("plan 必须是 TravelPlan JSON 对象")

    validated_plan = legacy.validate_generated_plan(plan)
    prepared_plan = legacy.normalize_plan_activity_periods(validated_plan)
    if target_plan_id:
        prepared_plan["id"] = target_plan_id
    prepared_plan = normalize_activity_titles_for_tool_plan(prepared_plan)
    enriched_plan, warnings = enrich_plan_coordinates_with_first_poi(
        plan=prepared_plan,
        cityname=normalized_cityname,
    )
    optimized_plan, route_summaries = optimize_plan_route_by_direct_distance(enriched_plan)
    legacy.logger.info(
        "optimize_travel_plan_route done | plan_id=%s | region=%s | route_summaries=%s | warnings=%s",
        str(optimized_plan.get("id", "")),
        normalized_cityname,
        compact_log_text(route_summaries, 8000),
        compact_log_text(warnings, 4000),
    )
    return {
        "ok": True,
        "plan": optimized_plan,
        "routeSummaries": route_summaries,
        "warnings": warnings,
    }


def create_travel_plan(cityname: str, plan: dict[str, Any], targetPlanId: str | None = None) -> dict[str, Any]:
    target_plan_id = str(targetPlanId or "").strip()
    legacy.logger.info(
        "create_travel_plan tool input | input=%s",
        compact_log_text({"cityname": cityname, "targetPlanId": target_plan_id, "plan": plan}, 12000),
    )
    normalized_cityname = normalize_cityname(cityname)
    if not isinstance(plan, dict):
        raise ValueError("plan 必须是 TravelPlan JSON 对象")

    validated_plan = legacy.validate_generated_plan(plan)
    prepared_plan = legacy.normalize_plan_activity_periods(validated_plan)
    if target_plan_id:
        prepared_plan["id"] = target_plan_id
    else:
        prepared_plan = legacy.assign_unique_plan_id(prepared_plan)
    prepared_plan = normalize_activity_titles_for_tool_plan(prepared_plan)
    prepared_plan = legacy.attach_selected_plan_image(prepared_plan)
    enriched_plan, warnings = enrich_plan_coordinates_with_first_poi(
        plan=prepared_plan,
        cityname=normalized_cityname,
    )
    return {
        "ok": True,
        "plan": enriched_plan,
        "warnings": warnings,
    }


def pick_first(*values: str) -> str:
    return next((clean_text(value) for value in values if clean_text(value)), "")


def get_title(html: str) -> str:
    match = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.I)
    return decode_html(match.group(1)) if match else ""


def get_meta(html: str, key: str, value: str) -> str:
    for match in re.finditer(r"<meta\b[^>]*>", html, re.I):
        tag = match.group(0)
        if (get_attr(tag, key) or "").lower() == value.lower():
            return decode_html(get_attr(tag, "content") or "")
    return ""


def get_attr(tag: str, name: str) -> str:
    pattern = rf'{re.escape(name)}\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>`]+))'
    match = re.search(pattern, tag, re.I)
    if not match:
        return ""
    return match.group(1) or match.group(2) or match.group(3) or ""


def get_embedded_text_hints(html: str) -> list[str]:
    hints: list[str] = []
    patterns = [
        r'"title"\s*:\s*"((?:\\.|[^"\\]){2,300})"',
        r'"desc"\s*:\s*"((?:\\.|[^"\\]){2,1200})"',
        r'"description"\s*:\s*"((?:\\.|[^"\\]){2,1200})"',
        r'"content"\s*:\s*"((?:\\.|[^"\\]){2,1200})"',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html):
            text = clean_text(unescape_json_string(match.group(1)))
            if text and text not in hints:
                hints.append(text)
            if len(hints) >= 20:
                return hints
    return hints


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def decode_html(value: str) -> str:
    replacements = {
        "&quot;": '"',
        "&#34;": '"',
        "&apos;": "'",
        "&#39;": "'",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
    }
    text = value
    for source, target in replacements.items():
        text = text.replace(source, target)
    text = re.sub(
        r"&#x([0-9a-f]+);",
        lambda item: chr(int(item.group(1), 16)),
        text,
        flags=re.I,
    )
    return re.sub(r"&#(\d+);", lambda item: chr(int(item.group(1))), text)


def unescape_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except Exception:
        return value.replace(r"\"", '"').replace(r"\n", "\n").replace(r"\t", "\t")


TOOL_FUNCTIONS = {
    "fetch_xhs_note": fetch_xhs_note,
    "optimize_travel_plan_route": optimize_travel_plan_route,
    "create_travel_plan": create_travel_plan,
}


def run_tool(tool_name: str, tool_input: dict[str, Any]) -> str:
    tool_function = TOOL_FUNCTIONS.get(tool_name)
    if tool_function is None:
        return json.dumps(
            {"error": f"Unknown tool: {tool_name}"},
            ensure_ascii=False,
        )

    try:
        result = tool_function(**tool_input)
        if isinstance(result, str):
            return result
        return json.dumps(result, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"error": str(exc)},
            ensure_ascii=False,
        )


@app.on_event("startup")
def on_startup() -> None:
    legacy.init_db()
    legacy.logger.info(
        "tool-first server startup complete | port=%s | db=%s | model=%s",
        legacy.PORT,
        legacy.to_db_path(),
        legacy.MODEL_NAME,
    )


@app.get("/api/health")
def get_health() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "tool-first",
        "hasApiKey": bool(legacy.API_KEY),
        "model": legacy.MODEL_NAME,
        "dbPath": str(legacy.to_db_path()),
    }


@app.get("/api/conversations")
def get_conversations() -> dict[str, Any]:
    with legacy.get_db_connection() as connection:
        conversations = legacy.list_conversations_from_db(connection)
    return {"conversations": conversations}


@app.post("/api/conversations")
def post_conversations() -> dict[str, Any]:
    conversation_id = f"conv_{uuid.uuid4().hex}"
    current_time = legacy.now_ms()
    with legacy.get_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO conversations (
              id, title, created_at, updated_at, message_count, state, plan_draft, pending_action
            )
            VALUES (?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (
                conversation_id,
                "新对话",
                current_time,
                current_time,
                legacy.DEFAULT_CONVERSATION_STATE,
                legacy.DEFAULT_PLAN_DRAFT_JSON,
                legacy.DEFAULT_PENDING_ACTION_JSON,
            ),
        )
        row = legacy.ensure_conversation_exists(connection, conversation_id)
    return {"conversation": legacy.to_conversation_meta(row)}


@app.get("/api/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str) -> dict[str, Any]:
    with legacy.get_db_connection() as connection:
        row = legacy.ensure_conversation_exists(connection, conversation_id)
        messages = legacy.list_messages_from_db(connection, conversation_id)
    return {
        "conversation": legacy.to_conversation_meta(row),
        "messages": messages,
    }


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, Any]:
    with legacy.get_db_connection() as connection:
        legacy.ensure_conversation_exists(connection, conversation_id)
        connection.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/chat/stream")
def post_conversation_chat_stream(
    conversation_id: str, body: legacy.ConversationChatInput
) -> StreamingResponse:
    if not legacy.API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is missing")

    request_id = f"req_{uuid.uuid4().hex[:12]}"
    started_at = time.perf_counter()
    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    current_plan = body.currentPlan if isinstance(body.currentPlan, dict) else None
    target_plan_id = (body.targetPlanId or "").strip()[:120]
    plan_context = (body.planContext or "").strip()[:12000]
    base_time = legacy.now_ms()
    user_message_id = f"msg_{uuid.uuid4().hex}"
    assistant_message_id = f"msg_{uuid.uuid4().hex}"

    with legacy.get_db_connection() as connection:
        legacy.ensure_conversation_exists(connection, conversation_id)
        connection.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, created_at)
            VALUES (?, ?, 'user', ?, ?)
            """,
            (user_message_id, conversation_id, user_message, base_time),
        )
        connection.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, created_at)
            VALUES (?, ?, 'assistant', '', ?)
            """,
            (assistant_message_id, conversation_id, base_time + 1),
        )
        model_messages = build_model_messages(
            connection=connection,
            conversation_id=conversation_id,
            user_message=user_message,
            current_plan=current_plan,
            target_plan_id=target_plan_id,
            plan_context=plan_context,
        )

    legacy.logger.info(
        "tool-first user input | request_id=%s | conversation_id=%s | message=%s | has_current_plan=%s | target_plan_id=%s | plan_context_chars=%s",
        request_id,
        conversation_id,
        compact_log_text(user_message, 2000),
        isinstance(current_plan, dict),
        target_plan_id,
        len(plan_context),
    )

    def event_stream():
        assistant_text = ""
        generated_plan_payload: dict[str, Any] | None = None
        generated_plan_tool_warnings: list[str] = []
        try:
            tool_messages: list[dict[str, Any]] = list(model_messages)
            max_tool_rounds = 4

            for round_index in range(1, max_tool_rounds + 1):
                legacy.logger.info(
                    "tool-first model request messages | request_id=%s | conversation_id=%s | round=%s | messages=%s",
                    request_id,
                    conversation_id,
                    round_index,
                    compact_log_text(tool_messages, 12000),
                )
                message = request_anthropic_with_tools(tool_messages)
                legacy.logger.info(
                    "tool-first model decision response | request_id=%s | conversation_id=%s | round=%s | response=%s",
                    request_id,
                    conversation_id,
                    round_index,
                    compact_log_text(summarize_anthropic_response(message), 12000),
                )

                tool_uses = collect_tool_uses(message.content)
                if not tool_uses:
                    assistant_text = collect_text_blocks(message.content)
                    legacy.logger.info(
                        "tool-first model reply | request_id=%s | conversation_id=%s | reply=%s",
                        request_id,
                        conversation_id,
                        compact_log_text(assistant_text),
                    )
                    if generated_plan_payload is not None:
                        if not assistant_text:
                            assistant_text = (
                                f"已为你生成计划：{generated_plan_payload.get('name', '新计划')}，"
                                "并完成地点坐标匹配。"
                            )
                        event_type = "plan_update" if target_plan_id and current_plan else "plan"
                        if event_type == "plan_update":
                            generated_plan_payload["id"] = target_plan_id
                        yield sse_payload(
                            {
                                "type": event_type,
                                "plan": generated_plan_payload,
                                "targetPlanId": target_plan_id if event_type == "plan_update" else None,
                                "assistantMessage": assistant_text,
                                "warnings": generated_plan_tool_warnings,
                                "model": legacy.MODEL_NAME,
                            }
                        )
                    else:
                        yield sse_payload({"type": "delta", "delta": assistant_text})
                    yield sse_payload({"type": "done", "done": True, "model": legacy.MODEL_NAME})
                    return

                tool_messages.append(
                    {
                        "role": "assistant",
                        "content": content_blocks_to_message_param(message.content),
                    }
                )
                insert_hidden_tool_event(
                    conversation_id=conversation_id,
                    role="assistant",
                    kind="tool_use",
                    content=content_blocks_to_message_param(message.content),
                )

                tool_result_blocks: list[dict[str, Any]] = []
                for tool_use in tool_uses:
                    tool_name = tool_use["name"]
                    tool_input = tool_use["input"] if isinstance(tool_use["input"], dict) else {}
                    legacy.logger.info(
                        "tool-first tool call | request_id=%s | conversation_id=%s | round=%s | tool=%s | input=%s",
                        request_id,
                        conversation_id,
                        round_index,
                        tool_name,
                        compact_log_text(tool_input),
                    )
                    tool_result = run_tool(tool_name, tool_input)
                    legacy.logger.info(
                        "tool-first tool result | request_id=%s | conversation_id=%s | round=%s | tool=%s | result=%s",
                        request_id,
                        conversation_id,
                        round_index,
                        tool_name,
                        compact_log_text(tool_result),
                    )
                    if tool_name == "create_travel_plan":
                        try:
                            parsed_tool_result = json.loads(tool_result)
                        except Exception:
                            parsed_tool_result = None
                        if (
                            isinstance(parsed_tool_result, dict)
                            and parsed_tool_result.get("ok") is True
                            and isinstance(parsed_tool_result.get("plan"), dict)
                        ):
                            generated_plan_payload = parsed_tool_result["plan"]
                            if target_plan_id and current_plan:
                                generated_plan_payload["id"] = target_plan_id
                            warnings = parsed_tool_result.get("warnings")
                            generated_plan_tool_warnings = warnings if isinstance(warnings, list) else []
                            legacy.logger.info(
                                "tool-first generated plan captured | request_id=%s | conversation_id=%s | plan_id=%s | plan_name=%s | warnings=%s",
                                request_id,
                                conversation_id,
                                str(generated_plan_payload.get("id", "")),
                                str(generated_plan_payload.get("name", "")),
                                compact_log_text(generated_plan_tool_warnings, 4000),
                            )
                    tool_result_blocks.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use["id"],
                            "content": tool_result,
                        }
                    )

                legacy.logger.info(
                    "tool-first tool result blocks | request_id=%s | conversation_id=%s | round=%s | blocks=%s",
                    request_id,
                    conversation_id,
                    round_index,
                    compact_log_text(tool_result_blocks, 12000),
                )
                insert_hidden_tool_event(
                    conversation_id=conversation_id,
                    role="user",
                    kind="tool_result",
                    content=tool_result_blocks,
                )
                tool_messages.append({"role": "user", "content": tool_result_blocks})

            assistant_text = "工具调用轮次过多，我先暂停了。你可以换个更具体的问题再试。"
            legacy.logger.warning(
                "tool-first max tool rounds reached | request_id=%s | conversation_id=%s | rounds=%s",
                request_id,
                conversation_id,
                max_tool_rounds,
            )
            yield sse_payload({"type": "delta", "delta": assistant_text})
            yield sse_payload({"type": "done", "done": True, "model": "max-tool-rounds"})
        except Exception as error:
            assistant_text = assistant_text.strip() or f"抱歉，这次处理失败了：{error}"
            legacy.logger.exception(
                "tool-first stream failed | request_id=%s | conversation_id=%s | error=%s",
                request_id,
                conversation_id,
                error,
            )
            yield sse_payload({"type": "error", "error": assistant_text})
        finally:
            with legacy.get_db_connection() as connection:
                connection.execute(
                    "UPDATE messages SET content = ?, created_at = ? WHERE id = ?",
                    (assistant_text, legacy.now_ms(), assistant_message_id),
                )
                legacy.refresh_conversation_stats(connection, conversation_id)
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            legacy.logger.info(
                "tool-first stream done | request_id=%s | conversation_id=%s | assistant_chars=%s | assistant_text=%s | elapsed_ms=%s",
                request_id,
                conversation_id,
                len(assistant_text),
                compact_log_text(assistant_text),
                elapsed_ms,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/ai/chat")
def post_chat(body: legacy.ChatInput) -> dict[str, Any]:
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    messages = legacy.normalize_messages(body)
    legacy.logger.info(
        "tool-first chat input | request_id=%s | messages=%s | last_message=%s",
        request_id,
        len(messages),
        compact_log_text(messages[-1].get("content", ""), 2000),
    )
    reply = legacy.request_anthropic(legacy.AI_CHAT_SYSTEM_PROMPT, messages)
    legacy.logger.info(
        "tool-first chat reply | request_id=%s | reply=%s",
        request_id,
        compact_log_text(reply),
    )
    return {"reply": reply, "usage": {"model": legacy.MODEL_NAME}}


if __name__ == "__main__":
    uvicorn.run("ai_server_tools:app", host="127.0.0.1", port=legacy.PORT, reload=False)
