from __future__ import annotations

import json
import os
from typing import Any

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
4. 当前服务是无记忆单轮问答：只能根据本次输入回答，不要假设你记得之前对话。
5. 不要默认进入旅游规划场景，除非用户明确提出相关需求。"""

PORT = int(os.environ.get("AI_SERVER_PORT", "8787"))
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_NAME = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")


class ChatInput(BaseModel):
    message: str


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def request_anthropic(system_prompt: str, user_prompt: str) -> str:
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
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Anthropic request failed: {error}"
        ) from error

    text = (getattr(response, "content", None) or [])
    for item in text:
        if getattr(item, "type", "") == "text" and getattr(item, "text", ""):
            return str(item.text)

    raise HTTPException(status_code=500, detail="No text returned from model")


def stream_anthropic(system_prompt: str, user_prompt: str):
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
                messages=[{"role": "user", "content": user_prompt}],
            ) as stream:
                for text in stream.text_stream:
                    if not text:
                        continue
                    payload = json.dumps({"delta": text}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"

            done_payload = json.dumps({"done": True, "model": MODEL_NAME}, ensure_ascii=False)
            yield f"data: {done_payload}\n\n"
        except Exception as error:
            error_payload = json.dumps(
                {"error": f"Anthropic stream failed: {error}"}, ensure_ascii=False
            )
            yield f"data: {error_payload}\n\n"

    return event_stream()


@app.get("/api/health")
def get_health() -> dict[str, Any]:
    return {
        "ok": True,
        "hasApiKey": bool(API_KEY),
        "model": MODEL_NAME,
    }


@app.post("/api/ai/chat")
def post_chat(body: ChatInput) -> dict[str, Any]:
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    reply = request_anthropic(AI_CHAT_SYSTEM_PROMPT, message)
    return {
        "reply": reply,
        "usage": {
            "model": MODEL_NAME,
        },
    }


@app.post("/api/ai/chat/stream")
def post_chat_stream(body: ChatInput) -> StreamingResponse:
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    stream = stream_anthropic(AI_CHAT_SYSTEM_PROMPT, message)
    return StreamingResponse(
        stream,
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
        detail="generate-plan 已禁用：当前 Python AI 服务仅支持 /api/ai/chat（无记忆单轮问答）",
    )


if __name__ == "__main__":
    uvicorn.run("ai_server:app", host="127.0.0.1", port=PORT, reload=False)
