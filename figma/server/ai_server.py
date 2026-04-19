from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Literal

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
DEFAULT_CONVERSATION_STATE = "normal_chat"
DEFAULT_PLAN_DRAFT_JSON = "{}"
DEFAULT_PENDING_ACTION_JSON = "{}"


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatInput(BaseModel):
    messages: list[ChatMessage] | None = None
    message: str | None = None


class ConversationChatInput(BaseModel):
    message: str


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

    logger = logging.getLogger("ai_server")
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    if logger.handlers:
        return logger

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        log_dir / "ai-server.log",
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


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(to_db_path(), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


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
    slot_keywords = {
        "预算",
        "天",
        "日",
        "城市",
        "出发",
        "开始日期",
        "风格",
        "偏好",
        "节奏",
        "人数",
        "亲子",
        "情侣",
        "老人",
        "美食",
        "拍照",
        "不爬山",
    }

    if any(keyword in text for keyword in generate_keywords):
        return "generate_plan"

    if text in confirm_keywords and conversation_state in {
        "awaiting_confirm_generate",
        "collecting_plan_slots",
    }:
        return "confirm"

    if text in reject_keywords:
        return "reject"

    if conversation_state in {"collecting_plan_slots", "awaiting_confirm_generate"} and any(
        keyword in text for keyword in slot_keywords
    ):
        return "update_slots"

    return "chat"


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
    logger.info(
        "startup complete | port=%s | db=%s | logs=%s | model=%s",
        PORT,
        to_db_path(),
        to_log_dir() / "ai-server.log",
        MODEL_NAME,
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
    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    started_at = time.perf_counter()
    logger.info(
        "conversation stream start | request_id=%s | conversation_id=%s | user_message=%s",
        request_id,
        conversation_id,
        user_message,
    )

    with get_db_connection() as connection:
        conversation_row = ensure_conversation_exists(connection, conversation_id)
        conversation_state = (
            str(conversation_row["state"])
            if "state" in conversation_row.keys() and conversation_row["state"]
            else DEFAULT_CONVERSATION_STATE
        )
        detected_intent = detect_intent(user_message, conversation_state)
        logger.info(
            "conversation stream intent | request_id=%s | conversation_id=%s | state=%s | intent=%s",
            request_id,
            conversation_id,
            conversation_state,
            detected_intent,
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
        model_messages = build_conversation_messages_for_model(connection, conversation_id)

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
            client = Anthropic(api_key=API_KEY, base_url=BASE_URL)
            with client.messages.stream(
                model=MODEL_NAME,
                max_tokens=2600,
                temperature=0,
                system=AI_CHAT_SYSTEM_PROMPT,
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
                    payload = json.dumps({"delta": text}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"

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
            done_payload = json.dumps({"done": True, "model": MODEL_NAME}, ensure_ascii=False)
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
            error_payload = json.dumps(
                {"error": f"Anthropic stream failed: {error}"}, ensure_ascii=False
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
