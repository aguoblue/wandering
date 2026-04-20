from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
import sqlite3
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote_plus, urlencode
from urllib.request import urlopen

from anthropic import Anthropic
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


AI_CHAT_SYSTEM_PROMPT = """你是一个中文 AI 助手。

要求：
1. 用简体中文回复。
2. 回答清晰、自然、直接，不要输出 Markdown 代码围栏。
3. 如果用户问题不明确，先基于常见合理理解给出回答，再简短指出可补充的信息。
4. 你可以使用当前会话历史回答问题，不要编造不存在的历史。"""

AI_PLAN_SYSTEM_PROMPT = """你是一个“旅行数据生成器”，只负责生成可直接用于前端渲染的结构化数据。

目标文件结构（必须严格匹配）：
- 顶层是 TravelPlan[] 数组
- 每个 plan 字段：
  id: string
  name: string
  tags: string[]
  duration: string
  highlight: string
  walkingIntensity: string
  budget: string
  image: string
  days: Day[]
  destination: string

- Day 字段：
  day: number
  date: string (YYYY-MM-DD)
  activities: Activity[]

- Activity 字段：
  id: string
  time: string (HH:mm-HH:mm)
  period: string（只能是：上午 / 中午 / 下午 / 晚上）
  title: string
  description: string
  reason: string
  duration: string
  transport: string
  alternatives: string[]
  coordinates: [number, number]

关键约束（必须满足）：
1. 只输出 JSON 数组：以 "[" 开始，以 "]" 结束；不要输出 Markdown，不要解释，不要代码围栏。
2. 必须是合法 JSON。
3. coordinates 顺序必须是 [经度, 纬度]。
4. 文案必须是中文。
5. 每个 activity.title 必须使用“城市+地点全称”格式，例如“深圳·海上世界文化艺术中心”；禁止只写“看展打卡/老街漫步”等泛化标题。"""

AI_PLAN_UPDATE_SYSTEM_PROMPT = """你是一个“旅行计划编辑器”，只负责输出可直接用于前端渲染的结构化数据。

你会收到：
1) 用户的修改请求
2) 当前完整计划 JSON

你的任务：
- 在当前计划基础上做修改，返回“修改后的完整计划”
- 不要丢字段，不要省略 day/activity
- 只输出 JSON 数组（长度=1），不要任何解释文本
- 必须是合法 JSON（双引号、无注释、无尾逗号）
- plan.id 必须保持不变
- 其余结构严格遵守 TravelPlan schema
- activity.title 必须尽量用“城市+地点全称”格式（例如“深圳·海上世界文化艺术中心”），不要改成泛化描述
"""

JSON_ARRAY_REPAIR_SYSTEM_PROMPT = """你是一个 JSON 修复器。

你会收到一段模型输出文本（可能包含解释、代码围栏或不合法 JSON）。
请将其修复为“合法 JSON 数组”并只输出该数组本身。

约束：
1) 根节点必须是数组。
2) 不要输出任何解释文字。
3) 必须是严格 JSON（双引号、无注释、无尾逗号）。
"""

PLAN_COLLECTION_SYSTEM_PROMPT = """你是一个中文旅行助理，负责在“生成旅行计划”对话里自然推进沟通。

要求：
1. 先回应用户当前这句话本身，不要只重复表单问题。
2. 若需要补充计划信息，请顺势追问最关键的 1-2 项，语气自然，不机械罗列。
3. 用户若表达想先普通聊天或暂缓计划，要尊重并切换到聊天语气。
4. 回答简洁、友好、直接，不要输出 Markdown 代码围栏。"""

STRUCTURED_EXTRACTION_SYSTEM_PROMPT = """你是一个对话状态抽取器。你的任务是把用户输入转成结构化 JSON。

必须遵守：
1. 只输出 JSON 对象，不要输出任何其他文字。
2. intent 只能是：chat, generate_plan, update_slots, confirm, reject。
3. confidence 是 0 到 1 的数字。
4. should_exit_plan_flow 是布尔值。
5. slots_patch 只能包含：city, days, budgetRange, style, startDate。
6. 未提到的字段不要猜测，不要填入 slots_patch。
7. 日期必须输出为 YYYY-MM-DD。"""

PORT = int(os.environ.get("AI_SERVER_PORT", "8787"))
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_NAME = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
DB_PATH = os.environ.get("CHAT_DB_PATH", "./server/data/chat.db")
LOG_DIR = os.environ.get("AI_SERVER_LOG_DIR", "./logs")
LOG_LEVEL = os.environ.get("AI_SERVER_LOG_LEVEL", "INFO").upper()
LOG_STREAM_CHUNKS = os.environ.get("AI_SERVER_LOG_STREAM_CHUNKS", "").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
LOG_AMAP_MATCH_DEBUG = os.environ.get("AI_SERVER_LOG_AMAP_MATCH", "").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
DEFAULT_CONVERSATION_STATE = "normal_chat"
DEFAULT_PLAN_DRAFT_JSON = "{}"
DEFAULT_PENDING_ACTION_JSON = "{}"
PLAN_REQUIRED_FIELDS = ("city", "days")
ALLOWED_INTENTS: set[str] = {"chat", "generate_plan", "update_slots", "confirm", "reject"}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatInput(BaseModel):
    messages: list[ChatMessage] | None = None
    message: str | None = None


class ConversationChatInput(BaseModel):
    message: str
    planContext: str | None = None
    targetPlanId: str | None = None
    currentPlan: dict[str, Any] | None = None


IntentType = Literal[
    "chat",
    "generate_plan",
    "confirm",
    "reject",
    "update_slots",
]


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_ms() -> int:
    return int(time.time() * 1000)


def to_db_path() -> Path:
    raw_path = Path(DB_PATH)
    if raw_path.is_absolute():
        return raw_path
    base_dir = Path(__file__).resolve().parent
    return (base_dir / raw_path).resolve()


def to_log_dir() -> Path:
    raw_path = Path(LOG_DIR)
    if raw_path.is_absolute():
        return raw_path
    base_dir = Path(__file__).resolve().parent
    return (base_dir / raw_path).resolve()


def configure_logging() -> logging.Logger:
    log_dir = to_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "ai-server.log"

    logger = logging.getLogger("ai_server")
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    if logger.handlers:
        return logger

    if log_file.exists():
        # Archive previous startup log so each run starts with a clean ai-server.log.
        timestamp = datetime.now().strftime("%Y%m%d%H%M")
        archived_log = log_file.with_name(f"{log_file.name}.{timestamp}")
        candidate = archived_log
        suffix_index = 1
        while candidate.exists():
            candidate = log_file.with_name(f"{archived_log.name}.{suffix_index}")
            suffix_index += 1
        log_file.rename(candidate)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=2 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    logger.propagate = False
    return logger


logger = configure_logging()
_frontend_env_cache: dict[str, str] | None = None


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(to_db_path(), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def load_frontend_env() -> dict[str, str]:
    global _frontend_env_cache
    if _frontend_env_cache is not None:
        return _frontend_env_cache

    env_map: dict[str, str] = {}
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                env_map[key.strip()] = value.strip().strip('"').strip("'")
        except Exception:
            env_map = {}

    _frontend_env_cache = env_map
    return env_map


def get_amap_key_with_source() -> tuple[str, str]:
    env_map = load_frontend_env()
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


def get_amap_key() -> str:
    key, _ = get_amap_key_with_source()
    return key


def init_db() -> None:
    db_path = to_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with get_db_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              message_count INTEGER NOT NULL DEFAULT 0,
              state TEXT NOT NULL DEFAULT 'normal_chat',
              plan_draft TEXT NOT NULL DEFAULT '{}',
              pending_action TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
              content TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
            ON conversations(updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
            ON messages(conversation_id, created_at);
            """
        )
        ensure_conversation_state_columns(connection)


def ensure_conversation_state_columns(connection: sqlite3.Connection) -> None:
    rows = connection.execute("PRAGMA table_info(conversations)").fetchall()
    existing_columns = {str(row["name"]) for row in rows}

    if "state" not in existing_columns:
        connection.execute(
            "ALTER TABLE conversations ADD COLUMN state TEXT NOT NULL DEFAULT 'normal_chat'"
        )
    if "plan_draft" not in existing_columns:
        connection.execute(
            "ALTER TABLE conversations ADD COLUMN plan_draft TEXT NOT NULL DEFAULT '{}'"
        )
    if "pending_action" not in existing_columns:
        connection.execute(
            "ALTER TABLE conversations ADD COLUMN pending_action TEXT NOT NULL DEFAULT '{}'"
        )


def parse_json_or_default(raw_text: Any, default_value: Any) -> Any:
    if not isinstance(raw_text, str) or not raw_text.strip():
        return default_value
    try:
        return json.loads(raw_text)
    except Exception:
        return default_value


def to_conversation_meta(row: sqlite3.Row) -> dict[str, Any]:
    state = str(row["state"]) if "state" in row.keys() and row["state"] else DEFAULT_CONVERSATION_STATE
    plan_draft = parse_json_or_default(
        row["plan_draft"] if "plan_draft" in row.keys() else DEFAULT_PLAN_DRAFT_JSON,
        {},
    )
    pending_action = parse_json_or_default(
        row["pending_action"] if "pending_action" in row.keys() else DEFAULT_PENDING_ACTION_JSON,
        {},
    )
    return {
        "id": row["id"],
        "title": row["title"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "messageCount": row["message_count"],
        "state": state,
        "planDraft": plan_draft,
        "pendingAction": pending_action,
    }


def to_message(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "createdAt": row["created_at"],
    }


def ensure_conversation_exists(connection: sqlite3.Connection, conversation_id: str) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT id, title, created_at, updated_at, message_count, state, plan_draft, pending_action
        FROM conversations
        WHERE id = ?
        """,
        (conversation_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return row


def list_conversations_from_db(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, title, created_at, updated_at, message_count, state, plan_draft, pending_action
        FROM conversations
        ORDER BY updated_at DESC
        """
    ).fetchall()
    return [to_conversation_meta(row) for row in rows]


def list_messages_from_db(connection: sqlite3.Connection, conversation_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, role, content, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        """,
        (conversation_id,),
    ).fetchall()
    return [to_message(row) for row in rows]


def list_recent_messages_for_context(
    connection: sqlite3.Connection, conversation_id: str, limit: int = 8
) -> list[dict[str, str]]:
    rows = connection.execute(
        """
        SELECT role, content
        FROM messages
        WHERE conversation_id = ? AND TRIM(content) <> ''
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (conversation_id, limit),
    ).fetchall()
    ordered_rows = list(reversed(rows))
    return [{"role": str(row["role"]), "content": str(row["content"])} for row in ordered_rows]


def derive_conversation_title(connection: sqlite3.Connection, conversation_id: str) -> str:
    row = connection.execute(
        """
        SELECT content
        FROM messages
        WHERE conversation_id = ? AND role = 'user' AND TRIM(content) <> ''
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (conversation_id,),
    ).fetchone()
    if row is None:
        return "新对话"
    title = " ".join(str(row["content"]).strip().split())
    return title[:24] if title else "新对话"


def refresh_conversation_stats(connection: sqlite3.Connection, conversation_id: str) -> None:
    current_time = now_ms()
    message_count_row = connection.execute(
        "SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?",
        (conversation_id,),
    ).fetchone()
    message_count = int(message_count_row["total"]) if message_count_row else 0
    title = derive_conversation_title(connection, conversation_id)
    connection.execute(
        """
        UPDATE conversations
        SET title = ?, updated_at = ?, message_count = ?
        WHERE id = ?
        """,
        (title, current_time, message_count, conversation_id),
    )


def normalize_messages(body: ChatInput) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []

    if body.messages:
        for item in body.messages:
            content = item.content.strip()
            if not content:
                continue
            normalized.append({"role": item.role, "content": content})

    if not normalized and body.message:
        fallback = body.message.strip()
        if fallback:
            normalized = [{"role": "user", "content": fallback}]

    if not normalized:
        raise HTTPException(status_code=400, detail="messages is required")

    return normalized[-24:]


def parse_first_json_object(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("no json object found")

    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("json root must be object")
    return parsed


def parse_first_json_array(raw_text: str) -> list[Any]:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass

    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise ValueError("no json array found")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, list):
        raise ValueError("json root must be array")
    return parsed


def build_plan_generation_user_prompt(plan_draft: dict[str, Any]) -> str:
    city = str(plan_draft.get("city", "深圳")).strip() or "深圳"
    days_raw = plan_draft.get("days", 2)
    try:
        days = int(days_raw)
    except Exception:
        days = 2
    if days < 1:
        days = 1
    if days > 7:
        days = 7
    budget_range = str(plan_draft.get("budgetRange", "¥800-1800")).strip() or "¥800-1800"
    style = str(plan_draft.get("style", "城市漫游、美食、轻松节奏")).strip() or "城市漫游、美食、轻松节奏"
    start_date = str(plan_draft.get("startDate", "")).strip()
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", start_date):
        start_date = datetime.now().strftime("%Y-%m-%d")
    generation_mode = str(plan_draft.get("generationMode", "")).strip()
    reference_guide = str(plan_draft.get("referenceGuide", "")).strip()

    if generation_mode == "replicate_guide" and reference_guide:
        return (
            "请按既定 schema 生成 1 条 TravelPlan 数据。\n\n"
            "当前任务不是自由发挥，而是“复刻当前攻略”为结构化计划。\n"
            "要求：\n"
            f"- 城市范围：{city}\n"
            f"- 每条 plan 天数：{days}天\n"
            f"- 风格偏好：{style}\n"
            f"- 预算区间：{budget_range}\n"
            f"- 开始日期：{start_date}\n"
            "- 语言：中文简体\n"
            "- 输出：仅 JSON 数组，不要任何解释文本\n\n"
            "强约束：\n"
            "- 以参考攻略里的 POI、顺序和路线为最高优先级，不要擅自替换成别的展馆、商圈或公园。\n"
            "- 如果参考攻略里已经有明确地点，如“海上世界文化艺术中心”，就必须沿用该地点，不要改写成 OCT/OTC 或其他艺术中心。\n"
            "- activity.title 必须写成“城市+地点全称”，例如“深圳·海上世界文化艺术中心”。\n"
            "- 允许你把口语攻略整理成更清晰的时间安排，但不要改变核心路线。\n"
            "- 若攻略里包含餐饮但用户未强调美食，可适当弱化餐饮描述，但不要把整条路线改成别的片区。\n"
            "- activities 尽量覆盖参考攻略中的关键站点；同一路线可合并相邻站点，但不要凭空发明新的主站点。\n\n"
            "参考攻略原文：\n"
            f"{reference_guide}"
        )

    return (
        "请按既定 schema 生成 1 条 TravelPlan 数据。\n\n"
        "要求：\n"
        f"- 城市范围：{city}\n"
        f"- 每条 plan 天数：{days}天\n"
        "- 每天活动数：4个\n"
        f"- 风格偏好：{style}\n"
        f"- 预算区间：{budget_range}\n"
        f"- 开始日期：{start_date}\n"
        "- 语言：中文简体\n"
        "- 输出：仅 JSON 数组，不要任何解释文本\n\n"
        "额外要求：\n"
        "- destination 必须与 plan 内容城市一致\n"
        "- name 要有吸引力且不重复\n"
        "- highlight 一句话概括卖点\n"
        "- 避免生成重复 POI 组合\n"
        "- 每个 activity.title 使用“城市+地点全称”格式，例如“深圳·海上世界文化艺术中心”"
    )


def validate_generated_plan(plan: Any) -> dict[str, Any]:
    if not isinstance(plan, dict):
        raise ValueError("invalid plan object")
    required = ["id", "name", "days", "destination", "budget", "walkingIntensity", "highlight", "image", "tags"]
    for field in required:
        if field not in plan:
            raise ValueError(f"plan missing field: {field}")
    if not isinstance(plan.get("days"), list) or not plan["days"]:
        raise ValueError("plan days is empty")
    return plan


def assign_unique_plan_id(plan: dict[str, Any]) -> dict[str, Any]:
    next_plan = dict(plan)
    destination = str(next_plan.get("destination", "")).strip()
    base_prefix = destination[:2].lower() if destination else "plan"
    if not re.fullmatch(r"[a-z0-9]+", base_prefix):
        base_prefix = "plan"
    next_plan["id"] = f"{base_prefix}_{uuid.uuid4().hex[:10]}"
    return next_plan


def clean_activity_keyword(title: str) -> str:
    keyword = (title or "").strip()
    if not keyword:
        return ""

    # "深圳·太子湾滨海公园" -> "太子湾滨海公园"
    if "·" in keyword:
        parts = [part.strip() for part in keyword.split("·") if part.strip()]
        if len(parts) >= 2:
            keyword = parts[-1]

    replacements = [
        "及楼顶花园",
        "及周边打卡",
        "观光车游览",
        "骑行散步",
        "美食探寻",
        "日落与夜景",
        "老街觅食",
        "看展",
        "打卡",
        "野餐",
    ]
    for suffix in replacements:
        if keyword.endswith(suffix):
            keyword = keyword[: -len(suffix)].strip()
    # 保留主地点名，去掉后面拼接说明
    keyword = re.sub(r"[•｜|]+.*$", "", keyword).strip()
    return keyword


def compose_destination_keyword(destination: str, candidate: str) -> str:
    destination_text = (destination or "").strip()
    candidate_text = (candidate or "").strip()
    if not destination_text:
        return candidate_text
    if not candidate_text:
        return destination_text
    if candidate_text.startswith(destination_text) or destination_text in candidate_text:
        return candidate_text
    return f"{destination_text}{candidate_text}"


def normalize_activity_titles_with_destination(plan: dict[str, Any]) -> dict[str, Any]:
    destination = str(plan.get("destination", "")).strip()
    if not destination:
        return plan

    next_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    for day in next_plan.get("days", []):
        activities = day.get("activities")
        if not isinstance(activities, list):
            continue
        for activity in activities:
            if not isinstance(activity, dict):
                continue
            title = str(activity.get("title", "")).strip()
            if not title:
                continue
            if destination in title:
                continue
            activity["title"] = f"{destination}·{title}"
    return next_plan


GENERIC_ACTIVITY_TOKENS = {
    "漫步",
    "散步",
    "拍照",
    "打卡",
    "观光",
    "游览",
    "体验",
    "休闲",
    "行程",
    "路线",
    "美食",
    "觅食",
    "探寻",
    "日落",
    "夜景",
    "早午餐",
    "早餐",
    "午餐",
    "晚餐",
}


POI_TYPE_HINTS = (
    "公园",
    "商场",
    "广场",
    "博物馆",
    "艺术中心",
    "文化艺术中心",
    "老街",
    "海滩",
    "沙滩",
    "绿道",
)


UNSPLASH_SOURCE_BASE = "https://source.unsplash.com"
IMAGE_FALLBACK_URL = "https://picsum.photos/seed/wandering-plan-cover/1600/900"
GENERIC_IMAGE_KEYWORDS = {
    "旅行",
    "旅游",
    "行程",
    "计划",
    "攻略",
    "打卡",
    "城市",
    "漫游",
    "之旅",
    "探索",
    "轻松",
    "深度",
}


def stable_text_hash(value: str) -> int:
    normalized = (value or "").strip()
    if not normalized:
        return 0

    total = 0
    for index, char in enumerate(normalized):
        total += (index + 1) * ord(char)
    return total


def filter_image_keywords(candidates: list[str], max_items: int = 6) -> list[str]:
    tokens: list[str] = []
    for raw_candidate in candidates:
        for token in tokenize_search_text(raw_candidate):
            if token in GENERIC_IMAGE_KEYWORDS:
                continue
            if token in tokens:
                continue
            tokens.append(token)
            if len(tokens) >= max_items:
                return tokens
    return tokens


def build_plan_image_keywords(plan: dict[str, Any]) -> list[str]:
    destination = str(plan.get("destination", "")).strip()
    name = str(plan.get("name", "")).strip()

    raw_candidates: list[str] = []
    if destination:
        raw_candidates.append(destination)
    if name:
        raw_candidates.append(name)

    tags = plan.get("tags")
    if isinstance(tags, list):
        for tag in tags[:3]:
            tag_text = str(tag).strip()
            if tag_text:
                raw_candidates.append(tag_text)

    days = plan.get("days")
    if isinstance(days, list):
        for day in days[:2]:
            activities = day.get("activities") if isinstance(day, dict) else None
            if not isinstance(activities, list):
                continue
            for activity in activities[:2]:
                if not isinstance(activity, dict):
                    continue
                title = str(activity.get("title", "")).strip()
                cleaned = clean_activity_keyword(title)
                if cleaned:
                    raw_candidates.append(cleaned)

    filtered = filter_image_keywords(raw_candidates)
    if not filtered and destination:
        return [destination, "landmark", "city"]
    if not filtered:
        return ["travel", "landmark", "city"]
    return filtered


def build_unsplash_source_url(keywords: list[str], seed: int) -> str:
    joined_keywords = ",".join(keywords[:5]) if keywords else "travel,city,landmark"
    # Add sig to reduce repeated image collisions while staying deterministic for a plan.
    sig = seed % 997 if seed else 1
    encoded_keywords = quote_plus(joined_keywords)
    return f"{UNSPLASH_SOURCE_BASE}/1600x900/?{encoded_keywords}&sig={sig}"


def select_plan_image_url(plan: dict[str, Any]) -> str:
    plan_id = str(plan.get("id", "")).strip()
    name = str(plan.get("name", "")).strip()
    destination = str(plan.get("destination", "")).strip()
    seed = stable_text_hash(f"{plan_id}|{name}|{destination}")
    keywords = build_plan_image_keywords(plan)
    return build_unsplash_source_url(keywords, seed)


def attach_selected_plan_image(plan: dict[str, Any]) -> dict[str, Any]:
    next_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    try:
        image_url = select_plan_image_url(next_plan)
    except Exception:
        logger.exception(
            "select plan image failed | plan_id=%s | destination=%s",
            str(next_plan.get("id", "")),
            str(next_plan.get("destination", "")),
        )
        image_url = ""
    next_plan["image"] = image_url or IMAGE_FALLBACK_URL
    return next_plan


def tokenize_search_text(value: str) -> list[str]:
    raw_tokens = re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", value or "")
    tokens: list[str] = []
    for token in raw_tokens:
        normalized = token.strip()
        if len(normalized) < 2:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        if normalized in tokens:
            continue
        tokens.append(normalized)
    return tokens


def parse_amap_location(value: Any) -> tuple[float, float] | None:
    location = str(value or "").strip()
    if not location or "," not in location:
        return None
    lng_text, lat_text = location.split(",", 1)
    try:
        return float(lng_text), float(lat_text)
    except Exception:
        return None


def score_amap_poi(
    *,
    poi: dict[str, Any],
    destination: str,
    keyword: str,
    context_keywords: list[str],
) -> int:
    name = str(poi.get("name", "")).strip()
    address = str(poi.get("address", "")).strip()
    poi_type = str(poi.get("type", "")).strip()
    pname = str(poi.get("pname", "")).strip()
    cityname = str(poi.get("cityname", "")).strip()
    adname = str(poi.get("adname", "")).strip()
    haystack = f"{name} {address} {pname} {cityname} {adname} {poi_type}"

    score = 0
    keyword_tokens = tokenize_search_text(keyword)
    context_tokens = []
    for item in context_keywords:
        context_tokens.extend(tokenize_search_text(item))
    all_tokens = []
    for token in keyword_tokens + context_tokens:
        if token in all_tokens:
            continue
        all_tokens.append(token)

    if keyword and keyword in name:
        score += 80

    matched_specific_token = False
    for token in all_tokens:
        if token in destination:
            continue

        if token in name:
            score += 22
            if token not in GENERIC_ACTIVITY_TOKENS:
                matched_specific_token = True
        elif token in haystack:
            score += 10

        if token in poi_type:
            score += 6

    if destination and destination in haystack:
        score += 18

    for hint in POI_TYPE_HINTS:
        if hint in keyword:
            if hint in name:
                score += 14
            else:
                score -= 18

    scenic_tokens = ("山", "海", "湖", "公园", "博物馆", "古镇", "寺", "塔", "广场", "老街")
    if any(token in keyword for token in scenic_tokens) and any(token in haystack for token in scenic_tokens):
        score += 10

    if not matched_specific_token and any(token in keyword for token in GENERIC_ACTIVITY_TOKENS):
        score -= 24

    return score


def request_amap_json(url: str) -> dict[str, Any] | None:
    try:
        with urlopen(url, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if isinstance(payload, dict):
            if str(payload.get("status", "")) not in {"1", "true", "True"}:
                logger.warning(
                    "amap request non-success | infocode=%s | info=%s | url=%s",
                    str(payload.get("infocode", "")),
                    str(payload.get("info", "")),
                    re.sub(r"key=[^&]+", "key=***", url),
                )
            return payload
    except Exception:
        logger.warning(
            "amap request failed | url=%s",
            re.sub(r"key=[^&]+", "key=***", url),
        )
        return None
    return None


def summarize_amap_pois_for_log(pois: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    for poi in pois[:limit]:
        if not isinstance(poi, dict):
            continue
        summary.append(
            {
                "id": str(poi.get("id", "")).strip(),
                "name": str(poi.get("name", "")).strip(),
                "address": str(poi.get("address", "")).strip(),
                "type": str(poi.get("type", "")).strip(),
                "location": str(poi.get("location", "")).strip(),
                "distance": str(poi.get("distance", "")).strip(),
            }
        )
    return summary


def collect_amap_text_pois(
    *,
    amap_key: str,
    destination: str,
    keyword: str,
    city_limit: bool,
) -> list[dict[str, Any]]:
    query = {
        "key": amap_key,
        "keywords": keyword,
        "region": destination or "全国",
        "city_limit": "true" if city_limit else "false",
        "show_fields": "business",
        "page_size": 20,
    }
    url = f"https://restapi.amap.com/v5/place/text?{urlencode(query)}"
    payload = request_amap_json(url)
    if not payload:
        if LOG_AMAP_MATCH_DEBUG:
            logger.info(
                "amap text search empty payload | keyword=%s | region=%s | city_limit=%s",
                keyword,
                destination or "全国",
                city_limit,
            )
        return []
    pois = payload.get("pois")
    if LOG_AMAP_MATCH_DEBUG:
        info = {
            "status": payload.get("status"),
            "infocode": payload.get("infocode"),
            "info": payload.get("info"),
            "count": len(pois) if isinstance(pois, list) else 0,
        }
        logger.info(
            "amap text search | keyword=%s | region=%s | city_limit=%s | meta=%s | top=%s",
            keyword,
            destination or "全国",
            city_limit,
            json.dumps(info, ensure_ascii=False),
            json.dumps(
                summarize_amap_pois_for_log(pois if isinstance(pois, list) else []),
                ensure_ascii=False,
            ),
        )
    return pois if isinstance(pois, list) else []


def collect_amap_around_pois(
    *,
    amap_key: str,
    keyword: str,
    seed_location: tuple[float, float],
) -> list[dict[str, Any]]:
    query = {
        "key": amap_key,
        "keywords": keyword,
        "location": f"{seed_location[0]},{seed_location[1]}",
        "radius": 8000,
        "sortrule": "distance",
        "show_fields": "business",
        "page_size": 20,
    }
    url = f"https://restapi.amap.com/v5/place/around?{urlencode(query)}"
    payload = request_amap_json(url)
    if not payload:
        if LOG_AMAP_MATCH_DEBUG:
            logger.info(
                "amap around search empty payload | keyword=%s | seed=%s",
                keyword,
                f"{seed_location[0]},{seed_location[1]}",
            )
        return []
    pois = payload.get("pois")
    if LOG_AMAP_MATCH_DEBUG:
        info = {
            "status": payload.get("status"),
            "infocode": payload.get("infocode"),
            "info": payload.get("info"),
            "count": len(pois) if isinstance(pois, list) else 0,
        }
        logger.info(
            "amap around search | keyword=%s | seed=%s | meta=%s | top=%s",
            keyword,
            f"{seed_location[0]},{seed_location[1]}",
            json.dumps(info, ensure_ascii=False),
            json.dumps(
                summarize_amap_pois_for_log(pois if isinstance(pois, list) else []),
                ensure_ascii=False,
            ),
        )
    return pois if isinstance(pois, list) else []


def search_amap_poi_coordinates(
    *,
    destination: str,
    keyword: str,
    context_keywords: list[str] | None = None,
    seed_location: tuple[float, float] | None = None,
) -> dict[str, Any] | None:
    amap_key = get_amap_key()
    if not amap_key or not keyword:
        return None

    best_choice: dict[str, Any] | None = None
    best_score = -10**9
    sampled_context = context_keywords or []
    specific_tokens = [
        token
        for token in tokenize_search_text(f"{keyword} {' '.join(sampled_context)}")
        if token not in destination and token not in GENERIC_ACTIVITY_TOKENS
    ]
    min_score = 8 if specific_tokens else 16

    strict_text = collect_amap_text_pois(
        amap_key=amap_key,
        destination=destination,
        keyword=keyword,
        city_limit=True,
    )
    relaxed_text = collect_amap_text_pois(
        amap_key=amap_key,
        destination=destination,
        keyword=keyword,
        city_limit=False,
    )
    text_collected: list[tuple[dict[str, Any], str]] = []
    text_collected.extend((poi, "text_strict") for poi in strict_text if isinstance(poi, dict))
    text_collected.extend((poi, "text_relaxed") for poi in relaxed_text if isinstance(poi, dict))

    def select_best_from_candidates(
        collected: list[tuple[dict[str, Any], str]],
        *,
        allow_around_bonus: bool,
    ) -> tuple[dict[str, Any] | None, int, list[dict[str, Any]]]:
        selected: dict[str, Any] | None = None
        selected_score = -10**9
        seen_keys: set[str] = set()
        scored: list[dict[str, Any]] = []

        for poi, source in collected:
            parsed_location = parse_amap_location(poi.get("location"))
            if not parsed_location:
                continue
            key = f"{str(poi.get('id', '')).strip()}|{parsed_location[0]},{parsed_location[1]}"
            if not str(poi.get("id", "")).strip():
                key = f"{str(poi.get('name', '')).strip()}|{parsed_location[0]},{parsed_location[1]}"
            if key in seen_keys:
                continue
            seen_keys.add(key)

            score = score_amap_poi(
                poi=poi,
                destination=destination,
                keyword=keyword,
                context_keywords=sampled_context,
            )
            if source == "text_strict":
                score += 2
            if allow_around_bonus and source == "around":
                score += 4

            scored.append(
                {
                    "source": source,
                    "score": score,
                    "name": str(poi.get("name", "")).strip(),
                    "address": str(poi.get("address", "")).strip(),
                    "type": str(poi.get("type", "")).strip(),
                    "location": f"{parsed_location[0]},{parsed_location[1]}",
                }
            )
            if score <= selected_score:
                continue
            selected_score = score
            selected = {
                "location": parsed_location,
                "name": str(poi.get("name", "")).strip(),
                "keyword": keyword,
                "score": score,
                "source": source,
            }
        return selected, selected_score, scored

    best_choice, best_score, scored_candidates = select_best_from_candidates(
        text_collected,
        allow_around_bonus=False,
    )

    if best_choice and best_score >= min_score:
        if LOG_AMAP_MATCH_DEBUG:
            top = sorted(scored_candidates, key=lambda item: int(item.get("score", -10**9)), reverse=True)[:8]
            logger.info(
                "amap match selected (text-first) | destination=%s | keyword=%s | min_score=%s | selected=%s | top_candidates=%s",
                destination,
                keyword,
                min_score,
                json.dumps(best_choice, ensure_ascii=False),
                json.dumps(top, ensure_ascii=False),
            )
        return best_choice

    around_scored: list[dict[str, Any]] = []
    if seed_location:
        around_pois = collect_amap_around_pois(
            amap_key=amap_key,
            keyword=keyword,
            seed_location=seed_location,
        )
        around_collected = [(poi, "around") for poi in around_pois if isinstance(poi, dict)]
        around_best, around_best_score, around_scored = select_best_from_candidates(
            around_collected,
            allow_around_bonus=True,
        )
        if around_best and around_best_score >= min_score:
            if LOG_AMAP_MATCH_DEBUG:
                top = sorted(around_scored, key=lambda item: int(item.get("score", -10**9)), reverse=True)[:8]
                logger.info(
                    "amap match selected (around-fallback) | destination=%s | keyword=%s | min_score=%s | selected=%s | top_candidates=%s",
                    destination,
                    keyword,
                    min_score,
                    json.dumps(around_best, ensure_ascii=False),
                    json.dumps(top, ensure_ascii=False),
                )
            return around_best

    if LOG_AMAP_MATCH_DEBUG:
        text_top = sorted(scored_candidates, key=lambda item: int(item.get("score", -10**9)), reverse=True)[:8]
        around_top = sorted(around_scored, key=lambda item: int(item.get("score", -10**9)), reverse=True)[:8]
        logger.info(
            "amap match rejected | destination=%s | keyword=%s | min_score=%s | text_top=%s | around_top=%s",
            destination,
            keyword,
            min_score,
            json.dumps(text_top, ensure_ascii=False),
            json.dumps(around_top, ensure_ascii=False),
        )
    return None


def enrich_plan_coordinates(plan: dict[str, Any]) -> dict[str, Any]:
    destination = str(plan.get("destination", "")).strip()
    days = plan.get("days")
    if not destination or not isinstance(days, list) or not days:
        return plan

    amap_key = get_amap_key()
    if not amap_key:
        logger.info("skip enrich plan coordinates | reason=missing_amap_key | plan_id=%s", str(plan.get("id", "")))
        return plan

    next_plan = json.loads(json.dumps(plan, ensure_ascii=False))
    resolved_count = 0

    for day in next_plan.get("days", []):
        activities = day.get("activities")
        if not isinstance(activities, list):
            continue
        for activity in activities:
            if not isinstance(activity, dict):
                continue

            title = str(activity.get("title", "")).strip()
            description = str(activity.get("description", "")).strip()
            seed_location = None
            coordinates_value = activity.get("coordinates")
            if (
                isinstance(coordinates_value, list)
                and len(coordinates_value) >= 2
            ):
                try:
                    seed_location = (float(coordinates_value[0]), float(coordinates_value[1]))
                except Exception:
                    seed_location = None
            alternatives = activity.get("alternatives")
            keyword_candidates = []

            cleaned_title = clean_activity_keyword(title)
            if cleaned_title and cleaned_title != destination:
                keyword_candidates.append(cleaned_title)
            if title and title not in keyword_candidates:
                keyword_candidates.append(title)

            description_head = re.split(r"[，。,；;]", description)[0].strip()
            if description_head and description_head not in keyword_candidates:
                keyword_candidates.append(description_head)

            if isinstance(alternatives, list):
                for item in alternatives[:2]:
                    candidate = str(item).strip()
                    if candidate and candidate not in keyword_candidates:
                        keyword_candidates.append(candidate)

            resolved_result: dict[str, Any] | None = None
            for candidate in keyword_candidates:
                resolved_result = search_amap_poi_coordinates(
                    destination=destination,
                    keyword=compose_destination_keyword(destination, candidate),
                    context_keywords=keyword_candidates,
                    seed_location=seed_location,
                ) or search_amap_poi_coordinates(
                    destination=destination,
                    keyword=candidate,
                    context_keywords=keyword_candidates,
                    seed_location=seed_location,
                )
                if resolved_result:
                    break

            if resolved_result and isinstance(resolved_result.get("location"), tuple):
                resolved_location = resolved_result["location"]
                activity["coordinates"] = [resolved_location[0], resolved_location[1]]
                resolved_count += 1
                logger.info(
                    "enrich activity coordinates | plan_id=%s | title=%s | keyword=%s | poi=%s | source=%s | score=%s | lng=%s | lat=%s",
                    str(next_plan.get("id", "")),
                    title,
                    str(resolved_result.get("keyword", "")),
                    str(resolved_result.get("name", "")),
                    str(resolved_result.get("source", "")),
                    str(resolved_result.get("score", "")),
                    resolved_location[0],
                    resolved_location[1],
                )
            else:
                logger.info(
                    "enrich activity coordinates skipped | plan_id=%s | title=%s | candidates=%s",
                    str(next_plan.get("id", "")),
                    title,
                    json.dumps(keyword_candidates, ensure_ascii=False),
                )

    logger.info(
        "enrich plan coordinates done | plan_id=%s | destination=%s | resolved=%s",
        str(next_plan.get("id", "")),
        destination,
        resolved_count,
    )
    return next_plan


def generate_plan_from_draft(plan_draft: dict[str, Any]) -> tuple[dict[str, Any], str]:
    base_prompt = build_plan_generation_user_prompt(plan_draft)
    parse_error: Exception | None = None
    generated_plan: dict[str, Any] | None = None

    for attempt in range(2):
        prompt = (
            base_prompt
            if attempt == 0
            else (
                f"{base_prompt}\n\n"
                "上一次输出解析失败。请严格只返回合法 JSON 数组（长度为1），不要输出任何额外文本。"
            )
        )
        raw_text = request_anthropic(
            AI_PLAN_SYSTEM_PROMPT,
            [{"role": "user", "content": prompt}],
        )
        try:
            plan_array = parse_first_json_array(raw_text)
            if not plan_array:
                raise ValueError("empty plan array")
            generated_plan = validate_generated_plan(plan_array[0])
            break
        except Exception as error:
            parse_error = error
            try:
                repaired_text = request_anthropic(
                    JSON_ARRAY_REPAIR_SYSTEM_PROMPT,
                    [
                        {
                            "role": "user",
                            "content": (
                                "请修复以下文本为合法 JSON 数组，仅输出数组：\n\n"
                                f"{raw_text}"
                            ),
                        }
                    ],
                )
                repaired_array = parse_first_json_array(repaired_text)
                if not repaired_array:
                    raise ValueError("empty repaired plan array")
                generated_plan = validate_generated_plan(repaired_array[0])
                break
            except Exception as repair_error:
                parse_error = repair_error
                continue

    if generated_plan is None:
        raise parse_error if parse_error else ValueError("plan generation parse failed")

    first_plan = assign_unique_plan_id(generated_plan)
    first_plan = normalize_activity_titles_with_destination(first_plan)
    first_plan = attach_selected_plan_image(first_plan)
    first_plan = enrich_plan_coordinates(first_plan)
    assistant_message = (
        f"已为你生成计划：{first_plan.get('name', '新计划')}。"
        f"目的地 {first_plan.get('destination', '')}，共 {len(first_plan.get('days', []))} 天，已加入计划列表。"
    )
    return first_plan, assistant_message


def build_plan_edit_user_prompt(
    *,
    target_plan_id: str,
    current_plan: dict[str, Any],
    user_message: str,
) -> str:
    return (
        "请基于“当前计划”执行用户提出的调整请求，输出 1 条更新后的 TravelPlan。\n\n"
        "输出要求：\n"
        "- 只输出 JSON 数组（长度为 1），不要解释文字。\n"
        f"- plan.id 必须保持为：{target_plan_id}\n"
        "- 尽量保留未被要求修改的部分，只改动用户明确提到的内容。\n"
        "- days/day/date/activity.id 结构保持合法。\n"
        "- 仍需满足 TravelPlan schema（中文文案、period 合法、coordinates 为 [经度, 纬度]）。\n\n"
        "- activity.title 尽量写为“城市+地点全称”（如“深圳·海上世界文化艺术中心”），不要使用抽象标题。\n\n"
        f"用户调整请求：{user_message}\n\n"
        f"当前计划 JSON：{json.dumps(current_plan, ensure_ascii=False)}"
    )


def detect_plan_edit_intent(
    *,
    user_message: str,
    current_plan: dict[str, Any],
) -> Literal["update_plan", "chat"]:
    if not API_KEY:
        return "update_plan" if should_attempt_current_plan_edit(user_message) else "chat"

    plan_name = str(current_plan.get("name", "")).strip()
    days_len = len(current_plan.get("days", [])) if isinstance(current_plan.get("days"), list) else 0
    prompt = (
        "请判断用户这句话在“计划详情页”里属于哪种意图。\n"
        "只输出 JSON：{\"intent\":\"update_plan|chat\"}\n"
        f"计划名：{plan_name}\n"
        f"计划天数：{days_len}\n"
        f"用户输入：{user_message}\n"
        "判断规则：\n"
        "- 询问/调整/删改计划内容（活动、预算、天数、路线、时段）=> update_plan\n"
        "- 纯闲聊、问候、与计划无关问题 => chat\n"
    )
    try:
        raw_text = request_anthropic(
            STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
            [{"role": "user", "content": prompt}],
        )
        payload = parse_first_json_object(raw_text)
        intent = str(payload.get("intent", "chat")).strip().lower()
        if intent == "update_plan":
            return "update_plan"
        return "chat"
    except Exception:
        return "update_plan" if should_attempt_current_plan_edit(user_message) else "chat"


def update_plan_from_existing(
    *,
    target_plan_id: str,
    current_plan: dict[str, Any],
    user_message: str,
) -> tuple[dict[str, Any], str]:
    base_prompt = build_plan_edit_user_prompt(
        target_plan_id=target_plan_id,
        current_plan=current_plan,
        user_message=user_message,
    )
    parse_error: Exception | None = None
    updated_plan: dict[str, Any] | None = None

    for attempt in range(2):
        prompt = (
            base_prompt
            if attempt == 0
            else (
                f"{base_prompt}\n\n"
                "上一次输出解析失败。请严格只返回合法 JSON 数组（长度为1），不要输出任何额外文本。"
            )
        )
        raw_text = request_anthropic(
            AI_PLAN_UPDATE_SYSTEM_PROMPT,
            [{"role": "user", "content": prompt}],
        )
        try:
            plan_array = parse_first_json_array(raw_text)
            if not plan_array:
                raise ValueError("empty updated plan array")
            updated_plan = validate_generated_plan(plan_array[0])
            break
        except Exception as error:
            parse_error = error
            try:
                repaired_text = request_anthropic(
                    JSON_ARRAY_REPAIR_SYSTEM_PROMPT,
                    [
                        {
                            "role": "user",
                            "content": (
                                "请修复以下文本为合法 JSON 数组，仅输出数组：\n\n"
                                f"{raw_text}"
                            ),
                        }
                    ],
                )
                repaired_array = parse_first_json_array(repaired_text)
                if not repaired_array:
                    raise ValueError("empty repaired plan array")
                updated_plan = validate_generated_plan(repaired_array[0])
                break
            except Exception as repair_error:
                parse_error = repair_error
                continue

    if updated_plan is None:
        raise parse_error if parse_error else ValueError("plan update parse failed")

    updated_plan["id"] = target_plan_id
    updated_plan = normalize_activity_titles_with_destination(updated_plan)
    updated_plan = attach_selected_plan_image(updated_plan)
    updated_plan = enrich_plan_coordinates(updated_plan)
    assistant_message = (
        f"已根据你的要求更新计划：{updated_plan.get('name', '当前计划')}。"
        f"现在共 {len(updated_plan.get('days', []))} 天，已同步到左侧计划视图。"
    )
    return updated_plan, assistant_message


def normalize_budget_range(raw_value: Any) -> str | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, (int, float)):
        amount = int(raw_value)
        return f"¥{amount}-{amount}" if amount > 0 else None

    value = str(raw_value).strip()
    if not value:
        return None

    range_match = re.search(r"(\d{2,6})\s*[-~到至]\s*(\d{2,6})", value)
    if range_match:
        low = int(range_match.group(1))
        high = int(range_match.group(2))
        if low > high:
            low, high = high, low
        return f"¥{low}-{high}"

    single_match = re.search(r"\d{2,6}", value)
    if single_match:
        amount = int(single_match.group(0))
        return f"¥{amount}-{amount}"

    return None


def has_explicit_budget_signal(text: str) -> bool:
    normalized = (text or "").strip()
    if not normalized:
        return False

    if "¥" in normalized or "￥" in normalized:
        return True

    signal_patterns = [
        r"(预算|花费|费用|消费|人均|开销)",
        r"\d{2,6}\s*元",
        r"\d{2,6}\s*块",
    ]
    return any(re.search(pattern, normalized) for pattern in signal_patterns)


def filter_budget_slot_by_context(
    *,
    slots_patch: dict[str, Any],
    context_text: str,
) -> dict[str, Any]:
    if "budgetRange" not in slots_patch:
        return slots_patch
    if has_explicit_budget_signal(context_text):
        return slots_patch

    next_slots = dict(slots_patch)
    next_slots.pop("budgetRange", None)
    return next_slots


def sanitize_slots_patch(raw_slots: Any) -> dict[str, Any]:
    if not isinstance(raw_slots, dict):
        return {}

    sanitized: dict[str, Any] = {}

    city = raw_slots.get("city")
    if city is not None:
        city_text = str(city).strip()
        if city_text:
            sanitized["city"] = city_text[:20]

    days = raw_slots.get("days")
    if days is not None:
        try:
            days_int = int(days)
            if 1 <= days_int <= 15:
                sanitized["days"] = days_int
        except Exception:
            pass

    budget = normalize_budget_range(raw_slots.get("budgetRange"))
    if budget:
        sanitized["budgetRange"] = budget

    style = raw_slots.get("style")
    if style is not None:
        style_text = str(style).strip()
        if style_text:
            sanitized["style"] = style_text[:80]

    start_date = raw_slots.get("startDate")
    if start_date is not None:
        start_date_text = str(start_date).strip()
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", start_date_text):
            sanitized["startDate"] = start_date_text

    return sanitized


def extract_turn_structured_by_ai(
    *,
    user_message: str,
    conversation_state: str,
    current_plan_draft: dict[str, Any],
    recent_messages: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    if not API_KEY:
        raise ValueError("ANTHROPIC_API_KEY is missing")

    today_text = datetime.now().strftime("%Y-%m-%d")
    recent_history_text = ""
    if recent_messages:
        formatted_history: list[str] = []
        for item in recent_messages[-8:]:
            role = "用户" if item.get("role") == "user" else "助手"
            content = str(item.get("content", "")).strip()
            if content:
                formatted_history.append(f"{role}：{content}")
        if formatted_history:
            recent_history_text = (
                "最近对话历史（可用于解析“按上面那个来”“从之前的信息来”等引用）：\n"
                + "\n".join(formatted_history)
                + "\n"
            )

    extraction_prompt = (
        "请抽取本轮对话结构化结果。\n"
        f"今天日期：{today_text}\n"
        f"当前会话状态：{conversation_state}\n"
        f"当前计划草稿：{json.dumps(current_plan_draft, ensure_ascii=False)}\n"
        f"{recent_history_text}"
        f"用户输入：{user_message}\n"
        "日期解析要求：\n"
        f"- “今天”映射为 {today_text}\n"
        "- “明天”映射为今天+1天\n"
        "- “后天”映射为今天+2天\n"
        "返回 JSON schema：\n"
        "{\n"
        '  "intent": "chat|generate_plan|update_slots|confirm|reject",\n'
        '  "confidence": 0.0,\n'
        '  "should_exit_plan_flow": false,\n'
        '  "slots_patch": {\n'
        '    "city": "string?",\n'
        '    "days": 0,\n'
        '    "budgetRange": "¥1000-2000?",\n'
        '    "style": "string?",\n'
        '    "startDate": "YYYY-MM-DD?"\n'
        "  }\n"
        "}\n"
        "只输出 JSON。"
    )
    raw_text = request_anthropic(
        STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
        [{"role": "user", "content": extraction_prompt}],
    )
    payload = parse_first_json_object(raw_text)

    intent_raw = str(payload.get("intent", "chat")).strip().lower()
    intent = intent_raw if intent_raw in ALLOWED_INTENTS else "chat"

    confidence_raw = payload.get("confidence", 0.0)
    try:
        confidence = float(confidence_raw)
    except Exception:
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    should_exit_plan_flow = bool(payload.get("should_exit_plan_flow", False))
    slots_patch = sanitize_slots_patch(payload.get("slots_patch"))

    return {
        "intent": intent,
        "confidence": confidence,
        "should_exit_plan_flow": should_exit_plan_flow,
        "slots_patch": slots_patch,
        "raw": payload,
    }


def should_exit_plan_flow(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False

    explicit_phrases = (
        "还是想聊天",
        "想聊天",
        "先聊天",
        "先聊聊",
        "聊聊天",
        "普通聊天",
        "不做计划",
        "不想做计划",
        "不需要计划",
        "不生成计划",
        "先不做计划",
        "先不生成",
    )
    if any(phrase in normalized for phrase in explicit_phrases):
        return True

    return bool(re.search(r"(算了|取消|不用|先不用|先别).{0,10}(计划|行程|攻略)?", normalized))


def should_update_plan_slots(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False

    # Avoid noisy single-character matching like "天" in "聊天".
    slot_patterns = [
        r"\d{1,2}\s*(?:天|日)",
        r"[一二两三四五六七八九十]\s*(?:天|日)",
        r"(预算|城市|出发|开始日期|风格|偏好|节奏|人数|亲子|情侣|老人|美食|拍照|不爬山)",
    ]
    return any(re.search(pattern, normalized) for pattern in slot_patterns)


def should_attempt_current_plan_edit(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    edit_patterns = [
        r"(修改|调整|改成|改为|改下|优化|更新)",
        r"(增加|加上|新增|补充)",
        r"(删除|删掉|去掉|移除)",
        r"(替换|换成|换为)",
        r"(提前|延后|推迟|压缩|放宽)",
        r"(第\s*[一二三四五六七八九十0-9]+\s*天)",
        r"(预算|时长|天数|行程|活动|景点|餐厅|交通|路线)",
    ]
    return any(re.search(pattern, normalized) for pattern in edit_patterns)


def looks_like_generate_request(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False

    if any(keyword in normalized for keyword in {"生成计划", "生成行程", "出行计划", "旅行计划", "旅游计划"}):
        return True

    if re.search(r"(给我|帮我).{0,6}生成.{0,6}(一个|一份)?", normalized):
        return True

    has_generate_verb = any(verb in normalized for verb in {"生成", "安排", "制定", "规划", "做"})
    has_plan_noun = any(noun in normalized for noun in {"计划", "行程", "攻略"})
    return has_generate_verb and has_plan_noun


def detect_intent(message: str, conversation_state: str = DEFAULT_CONVERSATION_STATE) -> IntentType:
    text = (message or "").strip().lower()
    if not text:
        return "chat"

    confirm_keywords = {
        "好",
        "好的",
        "可以",
        "行",
        "嗯",
        "嗯嗯",
        "是的",
        "确认",
        "开始吧",
        "生成吧",
        "就这样",
    }
    reject_keywords = {
        "不用",
        "先不用",
        "不要",
        "不需要",
        "取消",
        "算了",
        "等等",
        "先别",
    }
    generate_keywords = {
        "生成计划",
        "生成行程",
        "出行计划",
        "旅行计划",
        "旅游计划",
        "帮我做计划",
        "安排一下",
        "做个攻略",
        "制定行程",
    }
    if conversation_state in {"collecting_plan_slots", "awaiting_confirm_generate"} and should_exit_plan_flow(
        text
    ):
        return "reject"

    has_generate_verb = any(verb in text for verb in {"生成", "安排", "制定", "规划", "做"})
    has_plan_noun = any(noun in text for noun in {"计划", "行程", "攻略"})
    if any(keyword in text for keyword in generate_keywords) or (has_generate_verb and has_plan_noun):
        return "generate_plan"

    if re.search(r"(给我|帮我).{0,8}(一个|一份)?.{0,8}(计划|行程|攻略)", text):
        return "generate_plan"

    if re.search(r"(给我|帮我).{0,6}生成.{0,6}(一个|一份)?", text):
        return "generate_plan"

    if text in confirm_keywords and conversation_state in {
        "awaiting_confirm_generate",
        "collecting_plan_slots",
    }:
        return "confirm"

    if text in reject_keywords:
        return "reject"

    if conversation_state in {"collecting_plan_slots", "awaiting_confirm_generate"} and should_update_plan_slots(
        text
    ):
        return "update_slots"

    return "chat"


def extract_plan_slots_from_text(message: str) -> dict[str, Any]:
    text = (message or "").strip()
    if not text:
        return {}

    slots: dict[str, Any] = {}

    day_match = re.search(r"(\d{1,2})\s*(?:天|日)", text)
    if day_match:
        days = int(day_match.group(1))
        if 1 <= days <= 15:
            slots["days"] = days
    else:
        cn_day_map = {
            "一": 1,
            "二": 2,
            "两": 2,
            "三": 3,
            "四": 4,
            "五": 5,
            "六": 6,
            "七": 7,
            "八": 8,
            "九": 9,
            "十": 10,
        }
        cn_day_match = re.search(r"([一二两三四五六七八九十])\s*(?:天|日)", text)
        if cn_day_match:
            mapped_days = cn_day_map.get(cn_day_match.group(1))
            if mapped_days:
                slots["days"] = mapped_days

    budget_context_range_match = re.search(
        r"(预算|花费|费用|消费|人均|开销)[^\d¥￥]{0,8}[¥￥]?\s*(\d{2,6})\s*[-~到至]\s*[¥￥]?\s*(\d{2,6})",
        text,
    )
    budget_currency_range_match = re.search(r"[¥￥]\s*(\d{2,6})\s*[-~到至]\s*[¥￥]?\s*(\d{2,6})", text)
    budget_match = budget_context_range_match or budget_currency_range_match
    if budget_match:
        low = int(budget_match.group(2 if budget_context_range_match else 1))
        high = int(budget_match.group(3 if budget_context_range_match else 2))
        if low > high:
            low, high = high, low
        slots["budgetRange"] = f"¥{low}-{high}"
    else:
        budget_context_single_match = re.search(
            r"(预算|花费|费用|消费|人均|开销)[^\d¥￥]{0,8}[¥￥]?\s*(\d{2,6})",
            text,
        )
        budget_currency_single_match = re.search(r"[¥￥]\s*(\d{2,6})", text)
        single_budget_match = budget_context_single_match or budget_currency_single_match
        if single_budget_match:
            amount = int(single_budget_match.group(2 if budget_context_single_match else 1))
            slots["budgetRange"] = f"¥{amount}-{amount}"

    city_candidates = [
        "深圳",
        "北京",
        "上海",
        "广州",
        "杭州",
        "成都",
        "重庆",
        "西安",
        "南京",
        "苏州",
        "武汉",
        "长沙",
        "青岛",
        "厦门",
        "三亚",
        "昆明",
    ]
    for candidate in city_candidates:
        if candidate in text:
            slots["city"] = candidate
            break

    date_match = re.search(r"(20\d{2}-\d{2}-\d{2})", text)
    if date_match:
        slots["startDate"] = date_match.group(1)

    style_keywords = [
        "轻松节奏",
        "轻松",
        "城市漫游",
        "漫游",
        "美食",
        "拍照",
        "骑行",
        "散步",
        "看展",
        "展览",
        "夜景",
        "海滨",
        "滨海",
        "草坪野餐",
        "野餐",
        "文艺",
        "亲子",
        "情侣",
        "文化",
        "自然",
        "不爬山",
    ]
    matched_styles = [keyword for keyword in style_keywords if keyword in text]
    if matched_styles:
        slots["style"] = "、".join(dict.fromkeys(matched_styles))

    return slots


def refers_to_previous_context(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False

    reference_patterns = (
        "之前",
        "前面",
        "刚才",
        "上面",
        "那个信息",
        "那条",
        "那份",
        "这个计划",
        "这样一份",
        "按那个",
        "按上面",
        "从之前",
    )
    return any(pattern in text for pattern in reference_patterns)


def wants_replicate_current_guide(message: str) -> bool:
    text = (message or "").strip().lower()
    if not text:
        return False

    replicate_patterns = (
        "一样的计划",
        "一样的行程",
        "一样的攻略",
        "按这个攻略",
        "照这个攻略",
        "按照这个攻略",
        "按这条路线",
        "照这条路线",
        "复刻",
        "同款",
    )
    return any(pattern in text for pattern in replicate_patterns)


def looks_like_guide_content(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False

    guide_markers = ("➡️", "✅", "地铁", "步行", "打车", "看日落", "夜景", "路线")
    if any(marker in text for marker in guide_markers):
        return True
    return len(text) >= 120 and text.count("公园") + text.count("世界") + text.count("中心") >= 2


def extract_reference_guide_from_recent_messages(recent_messages: list[dict[str, str]]) -> str:
    for message in reversed(recent_messages):
        if message.get("role") != "user":
            continue
        content = str(message.get("content", "")).strip()
        if looks_like_guide_content(content):
            return content[:4000]
    return ""


def merge_slots_from_recent_context(
    *,
    user_message: str,
    current_plan_draft: dict[str, Any],
    extracted_slots: dict[str, Any],
    recent_messages: list[dict[str, str]],
) -> dict[str, Any]:
    if not recent_messages:
        return extracted_slots

    merged_slots = dict(extracted_slots)
    needs_context = refers_to_previous_context(user_message) or (
        looks_like_generate_request(user_message)
        and any(field not in {**current_plan_draft, **merged_slots} for field in PLAN_REQUIRED_FIELDS)
    )
    if not needs_context:
        return merged_slots

    recent_user_text = "\n".join(
        message["content"] for message in recent_messages if message.get("role") == "user"
    )
    if not recent_user_text.strip():
        return merged_slots

    context_slots = extract_plan_slots_from_text(recent_user_text)
    for key, value in context_slots.items():
        if key not in merged_slots and value not in (None, ""):
            merged_slots[key] = value

    return merged_slots


def merge_generation_mode_from_recent_context(
    *,
    user_message: str,
    current_plan_draft: dict[str, Any],
    recent_messages: list[dict[str, str]],
) -> dict[str, Any]:
    merged_context: dict[str, Any] = {}

    if isinstance(current_plan_draft.get("generationMode"), str) and current_plan_draft.get("generationMode"):
        merged_context["generationMode"] = current_plan_draft.get("generationMode")
    if isinstance(current_plan_draft.get("referenceGuide"), str) and current_plan_draft.get("referenceGuide"):
        merged_context["referenceGuide"] = current_plan_draft.get("referenceGuide")

    if not wants_replicate_current_guide(user_message):
        return merged_context

    # 优先使用当前这条用户输入里的攻略正文，避免“同一条消息里既说复刻又贴攻略”
    # 在写库前无法从 recent_messages 读到当前消息，导致复刻模式漏判。
    reference_guide = user_message[:4000] if looks_like_guide_content(user_message) else ""
    if not reference_guide:
        reference_guide = extract_reference_guide_from_recent_messages(recent_messages)
    if reference_guide:
        merged_context["generationMode"] = "replicate_guide"
        merged_context["referenceGuide"] = reference_guide

    return merged_context


def missing_plan_fields(plan_draft: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in PLAN_REQUIRED_FIELDS:
        value = plan_draft.get(field)
        if value is None:
            missing.append(field)
            continue
        if isinstance(value, str) and not value.strip():
            missing.append(field)
    return missing


def summarize_plan_draft(plan_draft: dict[str, Any]) -> str:
    city = str(plan_draft.get("city", "未设置"))
    days = str(plan_draft.get("days", "未设置"))
    budget = str(plan_draft.get("budgetRange", "未设置"))
    style = str(plan_draft.get("style", "未设置"))
    start_date = str(plan_draft.get("startDate", "未设置"))
    mode = str(plan_draft.get("generationMode", "")).strip()
    mode_text = "；模式：复刻当前攻略" if mode == "replicate_guide" else ""
    return f"城市：{city}；天数：{days}天；预算：{budget}；偏好：{style}；开始日期：{start_date}{mode_text}"


def build_slot_question(missing_fields: list[str], plan_draft: dict[str, Any]) -> str:
    prompts = {
        "city": "想去哪个城市？",
        "days": "计划玩几天？",
        "budgetRange": "预算区间大概是多少（例如 ¥1000-2000）？",
        "style": "旅行偏好是什么（例如轻松、美食、拍照、亲子）？",
    }
    questions = [prompts[field] for field in missing_fields if field in prompts]
    known = summarize_plan_draft(plan_draft)
    if not questions:
        return f"我先整理了你当前需求：{known}。还可以继续补充偏好。"
    return f"我先整理了你当前需求：{known}。为了继续生成，请补充：{' '.join(questions)}"


def build_plan_collection_messages(
    *,
    user_message: str,
    previous_state: str,
    next_state: str,
    detected_intent: IntentType,
    plan_draft: dict[str, Any],
    pending_action: dict[str, Any],
    fallback_reply: str,
) -> list[dict[str, str]]:
    missing_fields = missing_plan_fields(plan_draft)
    missing_text = "、".join(missing_fields) if missing_fields else "无"
    prompt = (
        "请基于以下结构化上下文生成给用户的下一句回复。\n"
        f"用户原话：{user_message}\n"
        f"意图识别：{detected_intent}\n"
        f"状态流转：{previous_state} -> {next_state}\n"
        f"当前计划草稿：{json.dumps(plan_draft, ensure_ascii=False)}\n"
        f"缺失字段：{missing_text}\n"
        f"待执行动作：{json.dumps(pending_action, ensure_ascii=False)}\n"
        f"规则兜底回复（可参考）：{fallback_reply}\n"
        "请只输出最终给用户的话。"
    )
    return [{"role": "user", "content": prompt}]


def update_conversation_context(
    connection: sqlite3.Connection,
    conversation_id: str,
    state: str,
    plan_draft: dict[str, Any],
    pending_action: dict[str, Any],
) -> None:
    connection.execute(
        """
        UPDATE conversations
        SET state = ?, plan_draft = ?, pending_action = ?
        WHERE id = ?
        """,
        (
            state,
            json.dumps(plan_draft, ensure_ascii=False),
            json.dumps(pending_action, ensure_ascii=False),
            conversation_id,
        ),
    )


def route_conversation_step3(
    *,
    user_message: str,
    detected_intent: IntentType,
    conversation_state: str,
    current_plan_draft: dict[str, Any],
    extracted_slots: dict[str, Any] | None = None,
    should_exit_plan: bool = False,
) -> tuple[bool, str, str, dict[str, Any], dict[str, Any]]:
    effective_slots = extracted_slots if isinstance(extracted_slots, dict) else extract_plan_slots_from_text(user_message)
    merged_draft = {**current_plan_draft, **effective_slots}
    generation_mode = str(merged_draft.get("generationMode", "")).strip()

    # 复刻攻略场景默认按 1 天先落地，避免用户已经给了完整路线却被“补天数”阻塞。
    if generation_mode == "replicate_guide" and not merged_draft.get("days"):
        merged_draft["days"] = 1

    if (should_exit_plan or detected_intent == "reject") and conversation_state in {
        "collecting_plan_slots",
        "awaiting_confirm_generate",
    }:
        return (
            True,
            "好，我们先切回普通聊天。等你想继续做计划时，告诉我“生成计划”就行。",
            DEFAULT_CONVERSATION_STATE,
            merged_draft,
            {},
        )

    should_collect_or_confirm = detected_intent in {"generate_plan", "update_slots"} or (
        conversation_state in {"collecting_plan_slots", "awaiting_confirm_generate"}
        and bool(effective_slots)
    )
    if not should_collect_or_confirm:
        return (False, "", conversation_state, current_plan_draft, {})

    missing_fields = missing_plan_fields(merged_draft)
    if missing_fields:
        return (
            True,
            build_slot_question(missing_fields, merged_draft),
            "collecting_plan_slots",
            merged_draft,
            {},
        )

    return (
        True,
        f"我已经整理好你的计划需求：{summarize_plan_draft(merged_draft)}。如果确认生成，请回复“好”或“生成吧”。",
        "awaiting_confirm_generate",
        merged_draft,
        {"type": "generate_plan", "createdAt": now_ms()},
    )


def build_conversation_messages_for_model(
    connection: sqlite3.Connection, conversation_id: str, limit: int = 24
) -> list[dict[str, str]]:
    rows = connection.execute(
        """
        SELECT role, content
        FROM messages
        WHERE conversation_id = ? AND TRIM(content) <> ''
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (conversation_id, limit),
    ).fetchall()
    ordered_rows = list(reversed(rows))
    return [{"role": str(row["role"]), "content": str(row["content"])} for row in ordered_rows]


def request_anthropic(system_prompt: str, messages: list[dict[str, str]]) -> str:
    if not API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is missing")

    client = Anthropic(
        api_key=API_KEY,
        base_url=BASE_URL,
    )

    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=2600,
            temperature=0,
            system=system_prompt,
            messages=messages,
        )
    except Exception as error:  # pragma: no cover - network call
        raise HTTPException(
            status_code=500, detail=f"Anthropic request failed: {error}"
        ) from error

    content = getattr(response, "content", None) or []
    for item in content:
        if getattr(item, "type", "") == "text" and getattr(item, "text", ""):
            return str(item.text)

    raise HTTPException(status_code=500, detail="No text returned from model")


def stream_anthropic(system_prompt: str, messages: list[dict[str, str]]):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is missing")

    client = Anthropic(
        api_key=API_KEY,
        base_url=BASE_URL,
    )

    def event_stream():
        try:
            with client.messages.stream(
                model=MODEL_NAME,
                max_tokens=2600,
                temperature=0,
                system=system_prompt,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    if not text:
                        continue
                    payload = json.dumps({"delta": text}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"

            done_payload = json.dumps({"done": True, "model": MODEL_NAME}, ensure_ascii=False)
            yield f"data: {done_payload}\n\n"
        except Exception as error:  # pragma: no cover - network call
            error_payload = json.dumps(
                {"error": f"Anthropic stream failed: {error}"}, ensure_ascii=False
            )
            yield f"data: {error_payload}\n\n"

    return event_stream()


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    amap_key, amap_key_source = get_amap_key_with_source()
    logger.info(
        "startup complete | port=%s | db=%s | logs=%s | model=%s | has_amap_key=%s | amap_key_source=%s",
        PORT,
        to_db_path(),
        to_log_dir() / "ai-server.log",
        MODEL_NAME,
        bool(amap_key),
        amap_key_source,
    )
    if amap_key_source.endswith("VITE_AMAP_KEY"):
        logger.warning(
            "backend amap key fallback to VITE_AMAP_KEY | this may cause USERKEY_PLAT_NOMATCH for REST API; prefer AMAP_WEB_KEY",
        )


@app.get("/api/health")
def get_health() -> dict[str, Any]:
    return {
        "ok": True,
        "hasApiKey": bool(API_KEY),
        "model": MODEL_NAME,
        "dbPath": str(to_db_path()),
    }


@app.get("/api/conversations")
def get_conversations() -> dict[str, Any]:
    with get_db_connection() as connection:
        conversations = list_conversations_from_db(connection)
    return {"conversations": conversations}


@app.post("/api/conversations")
def post_conversations() -> dict[str, Any]:
    conversation_id = f"conv_{uuid.uuid4().hex}"
    current_time = now_ms()
    with get_db_connection() as connection:
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
                DEFAULT_CONVERSATION_STATE,
                DEFAULT_PLAN_DRAFT_JSON,
                DEFAULT_PENDING_ACTION_JSON,
            ),
        )
        row = ensure_conversation_exists(connection, conversation_id)
    return {"conversation": to_conversation_meta(row)}


@app.get("/api/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str) -> dict[str, Any]:
    with get_db_connection() as connection:
        row = ensure_conversation_exists(connection, conversation_id)
        messages = list_messages_from_db(connection, conversation_id)
    return {
        "conversation": to_conversation_meta(row),
        "messages": messages,
    }


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, Any]:
    with get_db_connection() as connection:
        ensure_conversation_exists(connection, conversation_id)
        connection.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/chat/stream")
def post_conversation_chat_stream(
    conversation_id: str, body: ConversationChatInput
) -> StreamingResponse:
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    user_message = body.message.strip()
    hidden_plan_context = (body.planContext or "").strip()
    target_plan_id = (body.targetPlanId or "").strip()
    current_plan_payload = body.currentPlan if isinstance(body.currentPlan, dict) else None
    if len(hidden_plan_context) > 12000:
        hidden_plan_context = hidden_plan_context[:12000]
    if len(target_plan_id) > 120:
        target_plan_id = target_plan_id[:120]
    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    started_at = time.perf_counter()
    logger.info(
        "conversation stream start | request_id=%s | conversation_id=%s | user_message=%s | has_target_plan=%s | has_current_plan=%s | plan_context_chars=%s",
        request_id,
        conversation_id,
        user_message,
        bool(target_plan_id),
        isinstance(current_plan_payload, dict),
        len(hidden_plan_context),
    )

    direct_reply: str | None = None
    state_fallback_reply: str | None = None
    use_plan_collection_model = False
    model_messages: list[dict[str, str]] = []
    generated_plan_payload: dict[str, Any] | None = None
    generated_plan_assistant_message: str | None = None
    updated_plan_payload: dict[str, Any] | None = None
    updated_plan_assistant_message: str | None = None

    with get_db_connection() as connection:
        conversation_row = ensure_conversation_exists(connection, conversation_id)
        conversation_state = (
            str(conversation_row["state"])
            if "state" in conversation_row.keys() and conversation_row["state"]
            else DEFAULT_CONVERSATION_STATE
        )
        current_plan_draft = parse_json_or_default(
            conversation_row["plan_draft"] if "plan_draft" in conversation_row.keys() else "{}",
            {},
        )
        current_pending_action = parse_json_or_default(
            conversation_row["pending_action"] if "pending_action" in conversation_row.keys() else "{}",
            {},
        )
        recent_messages = list_recent_messages_for_context(connection, conversation_id)
        recent_user_context_text = "\n".join(
            message.get("content", "") for message in recent_messages if message.get("role") == "user"
        )
        detected_intent: IntentType = "chat"
        structured_slots_patch: dict[str, Any] = {}
        generation_context_patch: dict[str, Any] = {}
        should_exit_plan = False
        extraction_source = "rule"
        if API_KEY:
            try:
                structured = extract_turn_structured_by_ai(
                    user_message=user_message,
                    conversation_state=conversation_state,
                    current_plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                    recent_messages=recent_messages,
                )
                structured_intent = str(structured.get("intent", "chat"))
                detected_intent = (
                    structured_intent
                    if structured_intent in ALLOWED_INTENTS
                    else "chat"
                )  # type: ignore[assignment]
                structured_slots_patch = (
                    structured.get("slots_patch")
                    if isinstance(structured.get("slots_patch"), dict)
                    else {}
                )
                if not structured_slots_patch:
                    structured_slots_patch = extract_plan_slots_from_text(user_message)
                structured_slots_patch = merge_slots_from_recent_context(
                    user_message=user_message,
                    current_plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                    extracted_slots=structured_slots_patch,
                    recent_messages=recent_messages,
                )
                generation_context_patch = merge_generation_mode_from_recent_context(
                    user_message=user_message,
                    current_plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                    recent_messages=recent_messages,
                )
                structured_slots_patch = filter_budget_slot_by_context(
                    slots_patch=structured_slots_patch,
                    context_text=f"{recent_user_context_text}\n{user_message}",
                )
                should_exit_plan = bool(structured.get("should_exit_plan_flow", False))
                extraction_source = "ai"
                logger.info(
                    "conversation structured extraction | request_id=%s | conversation_id=%s | source=%s | intent=%s | confidence=%s | should_exit=%s | slots_patch=%s | raw=%s",
                    request_id,
                    conversation_id,
                    extraction_source,
                    detected_intent,
                    structured.get("confidence", 0.0),
                    should_exit_plan,
                    json.dumps(structured_slots_patch, ensure_ascii=False),
                    json.dumps(structured.get("raw", {}), ensure_ascii=False),
                )
            except Exception as error:
                logger.exception(
                    "conversation structured extraction failed | request_id=%s | conversation_id=%s | error=%s",
                    request_id,
                    conversation_id,
                    error,
                )

        if extraction_source != "ai":
            detected_intent = detect_intent(user_message, conversation_state)
            structured_slots_patch = extract_plan_slots_from_text(user_message)
            structured_slots_patch = merge_slots_from_recent_context(
                user_message=user_message,
                current_plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                extracted_slots=structured_slots_patch,
                recent_messages=recent_messages,
            )
            generation_context_patch = merge_generation_mode_from_recent_context(
                user_message=user_message,
                current_plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                recent_messages=recent_messages,
            )
            structured_slots_patch = filter_budget_slot_by_context(
                slots_patch=structured_slots_patch,
                context_text=f"{recent_user_context_text}\n{user_message}",
            )
            should_exit_plan = should_exit_plan_flow(user_message)

        logger.info(
            "conversation stream intent | request_id=%s | conversation_id=%s | state=%s | intent=%s | source=%s | slots_patch=%s | should_exit=%s",
            request_id,
            conversation_id,
            conversation_state,
            detected_intent,
            extraction_source,
            json.dumps(structured_slots_patch, ensure_ascii=False),
            should_exit_plan,
        )
        base_time = now_ms()
        user_message_id = f"msg_{uuid.uuid4().hex}"
        assistant_message_id = f"msg_{uuid.uuid4().hex}"

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
        should_generate_now = (
            detected_intent == "confirm"
            and conversation_state == "awaiting_confirm_generate"
            and isinstance(current_pending_action, dict)
            and str(current_pending_action.get("type", "")) == "generate_plan"
        )
        should_edit_current_plan = (
            API_KEY
            and bool(target_plan_id)
            and isinstance(current_plan_payload, dict)
        )

        if should_generate_now:
            try:
                generated_plan_payload, generated_plan_assistant_message = generate_plan_from_draft(
                    current_plan_draft if isinstance(current_plan_draft, dict) else {}
                )
                update_conversation_context(
                    connection=connection,
                    conversation_id=conversation_id,
                    state=DEFAULT_CONVERSATION_STATE,
                    plan_draft=current_plan_draft if isinstance(current_plan_draft, dict) else {},
                    pending_action={},
                )
                logger.info(
                    "conversation generate plan success | request_id=%s | conversation_id=%s | plan_id=%s | plan_name=%s",
                    request_id,
                    conversation_id,
                    str(generated_plan_payload.get("id", "")),
                    str(generated_plan_payload.get("name", "")),
                )
            except Exception as error:
                logger.exception(
                    "conversation generate plan failed | request_id=%s | conversation_id=%s | error=%s",
                    request_id,
                    conversation_id,
                    error,
                )
                direct_reply = "我尝试生成计划时失败了。你可以补充一下偏好后再让我重试。"
        elif should_edit_current_plan:
            try:
                edit_intent = detect_plan_edit_intent(
                    user_message=user_message,
                    current_plan=current_plan_payload,
                )
                if edit_intent == "update_plan":
                    updated_plan_payload, updated_plan_assistant_message = update_plan_from_existing(
                        target_plan_id=target_plan_id,
                        current_plan=current_plan_payload,
                        user_message=user_message,
                    )
                    direct_reply = updated_plan_assistant_message
                    logger.info(
                        "conversation update plan success | request_id=%s | conversation_id=%s | target_plan_id=%s",
                        request_id,
                        conversation_id,
                        target_plan_id,
                    )
                else:
                    model_messages = build_conversation_messages_for_model(connection, conversation_id)
            except Exception as error:
                logger.exception(
                    "conversation update plan failed | request_id=%s | conversation_id=%s | target_plan_id=%s | error=%s",
                    request_id,
                    conversation_id,
                    target_plan_id,
                    error,
                )
                direct_reply = "我尝试更新计划失败了。你可以再具体一点描述想改哪一天或哪个活动。"
        else:
            (
                is_state_handled,
                route_reply,
                next_state,
                next_plan_draft,
                next_pending_action,
            ) = route_conversation_step3(
                user_message=user_message,
                detected_intent=detected_intent,
                conversation_state=conversation_state,
                current_plan_draft={
                    **(current_plan_draft if isinstance(current_plan_draft, dict) else {}),
                    **generation_context_patch,
                },
                extracted_slots={**structured_slots_patch, **generation_context_patch},
                should_exit_plan=should_exit_plan,
            )

            if is_state_handled:
                state_fallback_reply = route_reply
                should_generate_immediately = (
                    detected_intent == "generate_plan"
                    and next_state == "awaiting_confirm_generate"
                    and isinstance(next_pending_action, dict)
                    and str(next_pending_action.get("type", "")) == "generate_plan"
                )
                if should_generate_immediately:
                    try:
                        generated_plan_payload, generated_plan_assistant_message = generate_plan_from_draft(
                            next_plan_draft
                        )
                        update_conversation_context(
                            connection=connection,
                            conversation_id=conversation_id,
                            state=DEFAULT_CONVERSATION_STATE,
                            plan_draft=next_plan_draft,
                            pending_action={},
                        )
                        logger.info(
                            "conversation auto generate plan success | request_id=%s | conversation_id=%s | plan_id=%s | plan_name=%s",
                            request_id,
                            conversation_id,
                            str(generated_plan_payload.get("id", "")),
                            str(generated_plan_payload.get("name", "")),
                        )
                    except Exception as error:
                        logger.exception(
                            "conversation auto generate plan failed | request_id=%s | conversation_id=%s | error=%s",
                            request_id,
                            conversation_id,
                            error,
                        )
                        direct_reply = "我尝试根据刚才的上下文直接生成计划，但失败了。你可以再补一句偏好，我继续帮你生成。"
                else:
                    update_conversation_context(
                        connection=connection,
                        conversation_id=conversation_id,
                        state=next_state,
                        plan_draft=next_plan_draft,
                        pending_action=next_pending_action,
                    )
                    logger.info(
                        "conversation state transition | request_id=%s | conversation_id=%s | from=%s | to=%s | plan_draft=%s | pending_action=%s",
                        request_id,
                        conversation_id,
                        conversation_state,
                        next_state,
                        json.dumps(next_plan_draft, ensure_ascii=False),
                        json.dumps(next_pending_action, ensure_ascii=False),
                    )
                    if API_KEY:
                        use_plan_collection_model = True
                        model_messages = build_plan_collection_messages(
                            user_message=user_message,
                            previous_state=conversation_state,
                            next_state=next_state,
                            detected_intent=detected_intent,
                            plan_draft=next_plan_draft,
                            pending_action=next_pending_action,
                            fallback_reply=route_reply,
                        )
                    else:
                        direct_reply = route_reply
            else:
                model_messages = build_conversation_messages_for_model(connection, conversation_id)

    if not direct_reply:
        logger.info(
            "conversation stream model messages | request_id=%s | conversation_id=%s | count=%s | payload=%s",
            request_id,
            conversation_id,
            len(model_messages),
            json.dumps(model_messages, ensure_ascii=False),
        )

    def event_stream():
        assistant_text = ""
        chunk_count = 0
        try:
            if updated_plan_payload is not None:
                assistant_text = updated_plan_assistant_message or "已根据你的要求更新计划。"
                plan_update_payload = json.dumps(
                    {
                        "type": "plan_update",
                        "intent": "update_plan",
                        "targetPlanId": target_plan_id,
                        "plan": updated_plan_payload,
                        "assistantMessage": assistant_text,
                        "model": MODEL_NAME,
                    },
                    ensure_ascii=False,
                )
                yield f"data: {plan_update_payload}\n\n"
                with get_db_connection() as connection:
                    connection.execute(
                        "UPDATE messages SET content = ? WHERE id = ?",
                        (assistant_text, assistant_message_id),
                    )
                    refresh_conversation_stats(connection, conversation_id)

                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                logger.info(
                    "conversation stream done (plan_update) | request_id=%s | conversation_id=%s | target_plan_id=%s | assistant_chars=%s | elapsed_ms=%s",
                    request_id,
                    conversation_id,
                    target_plan_id,
                    len(assistant_text),
                    elapsed_ms,
                )
                done_payload = json.dumps({"type": "done", "done": True, "model": MODEL_NAME}, ensure_ascii=False)
                yield f"data: {done_payload}\n\n"
                return

            if generated_plan_payload is not None:
                assistant_text = generated_plan_assistant_message or "已为你生成计划并加入列表。"
                plan_payload = json.dumps(
                    {
                        "type": "plan",
                        "plan": generated_plan_payload,
                        "assistantMessage": assistant_text,
                        "model": MODEL_NAME,
                    },
                    ensure_ascii=False,
                )
                yield f"data: {plan_payload}\n\n"
                with get_db_connection() as connection:
                    connection.execute(
                        "UPDATE messages SET content = ? WHERE id = ?",
                        (assistant_text, assistant_message_id),
                    )
                    refresh_conversation_stats(connection, conversation_id)

                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                logger.info(
                    "conversation stream done (plan) | request_id=%s | conversation_id=%s | assistant_chars=%s | elapsed_ms=%s",
                    request_id,
                    conversation_id,
                    len(assistant_text),
                    elapsed_ms,
                )
                done_payload = json.dumps({"type": "done", "done": True, "model": MODEL_NAME}, ensure_ascii=False)
                yield f"data: {done_payload}\n\n"
                return

            if direct_reply is not None:
                assistant_text = direct_reply
                chunk_count = 1
                payload = json.dumps({"type": "delta", "delta": direct_reply}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
                with get_db_connection() as connection:
                    connection.execute(
                        "UPDATE messages SET content = ? WHERE id = ?",
                        (assistant_text, assistant_message_id),
                    )
                    refresh_conversation_stats(connection, conversation_id)

                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                logger.info(
                    "conversation stream done (state) | request_id=%s | conversation_id=%s | chunks=%s | assistant_chars=%s | elapsed_ms=%s",
                    request_id,
                    conversation_id,
                    chunk_count,
                    len(assistant_text),
                    elapsed_ms,
                )
                done_payload = json.dumps({"type": "done", "done": True, "model": "state-router"}, ensure_ascii=False)
                yield f"data: {done_payload}\n\n"
                return

            client = Anthropic(api_key=API_KEY, base_url=BASE_URL)
            system_prompt = PLAN_COLLECTION_SYSTEM_PROMPT if use_plan_collection_model else AI_CHAT_SYSTEM_PROMPT
            if hidden_plan_context and not use_plan_collection_model:
                system_prompt = (
                    f"{system_prompt}\n\n"
                    "以下是当前计划上下文，仅供参考，不要逐字复述。"
                    " 回答时优先基于用户刚输入的问题：\n"
                    f"{hidden_plan_context}"
                )
            if isinstance(current_plan_payload, dict) and not use_plan_collection_model:
                system_prompt = (
                    f"{system_prompt}\n\n"
                    "以下是当前计划的完整 JSON（高优先级事实来源）。"
                    " 当用户询问具体安排、时间、地点时，请优先依据该 JSON 回答；"
                    " 如果 JSON 里没有该字段，再明确说明缺失并给建议：\n"
                    f"{json.dumps(current_plan_payload, ensure_ascii=False)}"
                )
            with client.messages.stream(
                model=MODEL_NAME,
                max_tokens=2600,
                temperature=0,
                system=system_prompt,
                messages=model_messages,
            ) as stream:
                for text in stream.text_stream:
                    if not text:
                        continue
                    chunk_count += 1
                    assistant_text += text
                    if LOG_STREAM_CHUNKS:
                        logger.debug(
                            "conversation stream chunk | request_id=%s | conversation_id=%s | chunk_index=%s | chunk_chars=%s",
                            request_id,
                            conversation_id,
                            chunk_count,
                            len(text),
                        )
                    payload = json.dumps({"type": "delta", "delta": text}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"

            if not assistant_text.strip():
                retry_text = ""
                try:
                    retry_text = request_anthropic(system_prompt, model_messages).strip()
                except Exception as retry_error:
                    logger.warning(
                        "conversation empty stream retry failed | request_id=%s | conversation_id=%s | error=%s",
                        request_id,
                        conversation_id,
                        retry_error,
                    )

                if retry_text:
                    assistant_text = retry_text
                    with get_db_connection() as connection:
                        connection.execute(
                            "UPDATE messages SET content = ? WHERE id = ?",
                            (assistant_text, assistant_message_id),
                        )
                        refresh_conversation_stats(connection, conversation_id)
                    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                    logger.warning(
                        "conversation stream empty recovered by sync retry | request_id=%s | conversation_id=%s | assistant_chars=%s | elapsed_ms=%s",
                        request_id,
                        conversation_id,
                        len(assistant_text),
                        elapsed_ms,
                    )
                    retry_payload = json.dumps({"type": "delta", "delta": assistant_text}, ensure_ascii=False)
                    yield f"data: {retry_payload}\n\n"
                    done_payload = json.dumps({"type": "done", "done": True, "model": "empty-stream-sync-retry"}, ensure_ascii=False)
                    yield f"data: {done_payload}\n\n"
                    return

                fallback_text = (
                    state_fallback_reply
                    if use_plan_collection_model and state_fallback_reply
                    else "我这次没有成功生成回复内容，请重试。"
                )
                with get_db_connection() as connection:
                    connection.execute(
                        "UPDATE messages SET content = ? WHERE id = ?",
                        (fallback_text, assistant_message_id),
                    )
                    refresh_conversation_stats(connection, conversation_id)

                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                logger.warning(
                    "conversation stream empty | request_id=%s | conversation_id=%s | elapsed_ms=%s | fallback_used=%s",
                    request_id,
                    conversation_id,
                    elapsed_ms,
                    bool(fallback_text),
                )
                fallback_payload = json.dumps({"type": "delta", "delta": fallback_text}, ensure_ascii=False)
                yield f"data: {fallback_payload}\n\n"
                done_payload = json.dumps({"type": "done", "done": True, "model": "empty-stream-fallback"}, ensure_ascii=False)
                yield f"data: {done_payload}\n\n"
                return

            with get_db_connection() as connection:
                connection.execute(
                    "UPDATE messages SET content = ? WHERE id = ?",
                    (assistant_text, assistant_message_id),
                )
                refresh_conversation_stats(connection, conversation_id)

            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.info(
                "conversation stream done | request_id=%s | conversation_id=%s | chunks=%s | assistant_chars=%s | elapsed_ms=%s",
                request_id,
                conversation_id,
                chunk_count,
                len(assistant_text),
                elapsed_ms,
            )
            done_payload = json.dumps({"type": "done", "done": True, "model": MODEL_NAME}, ensure_ascii=False)
            yield f"data: {done_payload}\n\n"
        except Exception as error:  # pragma: no cover - network call
            with get_db_connection() as connection:
                fallback_text = assistant_text.strip() or "抱歉，这次回复失败了，请重试。"
                connection.execute(
                    "UPDATE messages SET content = ? WHERE id = ?",
                    (fallback_text, assistant_message_id),
                )
                refresh_conversation_stats(connection, conversation_id)

            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.exception(
                "conversation stream failed | request_id=%s | conversation_id=%s | chunks=%s | partial_chars=%s | elapsed_ms=%s",
                request_id,
                conversation_id,
                chunk_count,
                len(assistant_text),
                elapsed_ms,
            )
            if use_plan_collection_model and not assistant_text and state_fallback_reply:
                with get_db_connection() as connection:
                    connection.execute(
                        "UPDATE messages SET content = ? WHERE id = ?",
                        (state_fallback_reply, assistant_message_id),
                    )
                    refresh_conversation_stats(connection, conversation_id)
                fallback_payload = json.dumps({"type": "delta", "delta": state_fallback_reply}, ensure_ascii=False)
                yield f"data: {fallback_payload}\n\n"
                done_payload = json.dumps({"type": "done", "done": True, "model": "state-router-fallback"}, ensure_ascii=False)
                yield f"data: {done_payload}\n\n"
                return
            error_payload = json.dumps(
                {"type": "error", "error": f"Anthropic stream failed: {error}"}, ensure_ascii=False
            )
            yield f"data: {error_payload}\n\n"

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
def post_chat(body: ChatInput) -> dict[str, Any]:
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    messages = normalize_messages(body)
    started_at = time.perf_counter()
    logger.info(
        "chat start | request_id=%s | messages=%s | last_role=%s | last_chars=%s",
        request_id,
        len(messages),
        messages[-1]["role"],
        len(messages[-1]["content"]),
    )
    reply = request_anthropic(AI_CHAT_SYSTEM_PROMPT, messages)
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    logger.info(
        "chat done | request_id=%s | reply_chars=%s | elapsed_ms=%s",
        request_id,
        len(reply),
        elapsed_ms,
    )
    return {
        "reply": reply,
        "usage": {
            "model": MODEL_NAME,
        },
    }


@app.post("/api/ai/chat/stream")
def post_chat_stream(body: ChatInput) -> StreamingResponse:
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    messages = normalize_messages(body)
    started_at = time.perf_counter()
    logger.info(
        "chat stream start | request_id=%s | messages=%s | last_role=%s | last_chars=%s",
        request_id,
        len(messages),
        messages[-1]["role"],
        len(messages[-1]["content"]),
    )

    base_stream = stream_anthropic(AI_CHAT_SYSTEM_PROMPT, messages)

    def logged_stream():
        chunk_count = 0
        reply_chars = 0
        try:
            for event in base_stream:
                if '"delta"' in event:
                    chunk_count += 1
                    try:
                        payload_text = event.removeprefix("data: ").strip()
                        payload = json.loads(payload_text)
                        delta = str(payload.get("delta", ""))
                        reply_chars += len(delta)
                        if LOG_STREAM_CHUNKS and delta:
                            logger.debug(
                                "chat stream chunk | request_id=%s | chunk_index=%s | chunk_chars=%s",
                                request_id,
                                chunk_count,
                                len(delta),
                            )
                    except Exception:
                        logger.debug(
                            "chat stream chunk parse skipped | request_id=%s | chunk_index=%s",
                            request_id,
                            chunk_count,
                        )
                yield event

            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.info(
                "chat stream done | request_id=%s | chunks=%s | reply_chars=%s | elapsed_ms=%s",
                request_id,
                chunk_count,
                reply_chars,
                elapsed_ms,
            )
        except Exception:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.exception(
                "chat stream failed | request_id=%s | chunks=%s | partial_chars=%s | elapsed_ms=%s",
                request_id,
                chunk_count,
                reply_chars,
                elapsed_ms,
            )
            raise

    return StreamingResponse(
        logged_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/ai/generate-plan")
def post_generate_plan_disabled() -> dict[str, Any]:
    raise HTTPException(
        status_code=410,
        detail="generate-plan 已禁用：当前 Python AI 服务仅支持聊天接口",
    )


if __name__ == "__main__":
    uvicorn.run("ai_server:app", host="127.0.0.1", port=PORT, reload=False)
