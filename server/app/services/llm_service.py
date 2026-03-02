"""
LLM Service — Unified interface for LLM API calls.

Supports OpenAI and Anthropic, with streaming.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator

from app.core.config import settings

logger = logging.getLogger(__name__)


def _resolve_provider_and_model(
    module: str | None,
    model_override: str | None,
) -> tuple[str, str | None]:
    """Resolve provider + model for a given module.

    Priority:
    1. If ``model_override`` is given, use it with the module's provider.
    2. Else derive both from the module config.
    3. If no module, fall back to global LLM_PROVIDER.
    """
    if module:
        provider = settings.get_module_provider(module)
        model = model_override or settings.get_module_model(module) or None
    else:
        provider = settings.LLM_PROVIDER
        model = model_override
    return provider, model


async def llm_complete(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    enable_search: bool = False,
    module: str | None = None,
) -> str:
    """Non-streaming LLM completion. Returns full text.

    Args:
        module: Functional module name (``resume`` | ``interview`` | ``research`` | ``eval``).
                When provided, provider and model are resolved from per-module settings.
                ``model`` still acts as an override if supplied together with ``module``.
        enable_search: Enable web search. Qwen uses DashScope enable_search parameter;
                       Moonshot uses builtin $web_search function calling.
    """
    provider, resolved_model = _resolve_provider_and_model(module, model)

    if provider == "qwen":
        return await _qwen_complete(messages, resolved_model, temperature, max_tokens, enable_search=enable_search)
    elif provider == "moonshot":
        return await _moonshot_complete(messages, resolved_model, temperature, max_tokens, enable_search=enable_search)
    elif provider == "anthropic":
        return await _anthropic_complete(messages, resolved_model, temperature, max_tokens)
    else:  # openai
        return await _openai_complete(messages, resolved_model, temperature, max_tokens)


async def llm_stream(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    module: str | None = None,
) -> AsyncIterator[str]:
    """Streaming LLM completion. Yields tokens as they arrive.

    Args:
        module: Functional module name (``resume`` | ``interview`` | ``research`` | ``eval``).
    """
    provider, resolved_model = _resolve_provider_and_model(module, model)

    if provider == "qwen":
        async for token in _qwen_stream(messages, resolved_model, temperature, max_tokens):
            yield token
    elif provider == "moonshot":
        async for token in _moonshot_stream(messages, resolved_model, temperature, max_tokens):
            yield token
    elif provider == "anthropic":
        async for token in _anthropic_stream(messages, resolved_model, temperature, max_tokens):
            yield token
    else:  # openai
        async for token in _openai_stream(messages, resolved_model, temperature, max_tokens):
            yield token


# ── OpenAI ───────────────────────────────────────────────────

async def _openai_complete(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )
    resp = await client.chat.completions.create(
        model=model or settings.OPENAI_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content or ""


async def _openai_stream(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> AsyncIterator[str]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )
    stream = await client.chat.completions.create(
        model=model or settings.OPENAI_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


# ── Anthropic ────────────────────────────────────────────────

async def _anthropic_complete(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    # Convert OpenAI-style messages to Anthropic format
    system_msg, user_msgs = _split_system_messages(messages)

    resp = await client.messages.create(
        model=model or settings.ANTHROPIC_MODEL,
        system=system_msg,
        messages=user_msgs,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.content[0].text


async def _anthropic_stream(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> AsyncIterator[str]:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    system_msg, user_msgs = _split_system_messages(messages)

    async with client.messages.stream(
        model=model or settings.ANTHROPIC_MODEL,
        system=system_msg,
        messages=user_msgs,
        temperature=temperature,
        max_tokens=max_tokens,
    ) as stream:
        async for text in stream.text_stream:
            yield text


def _split_system_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """Split system messages from user/assistant messages for Anthropic API."""
    system_parts = []
    other_msgs = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
        else:
            other_msgs.append(m)
    return "\n\n".join(system_parts), other_msgs


# ── Alibaba Qwen ────────────────────────────────────────────

async def _qwen_complete(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int,
    enable_search: bool = False,
) -> str:
    """Qwen completion via OpenAI-compatible API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.QWEN_API_KEY,
        base_url=settings.QWEN_BASE_URL,
    )
    
    extra_params: dict = {}
    if enable_search:
        # DashScope web search: pass via extra_body
        extra_params["extra_body"] = {"enable_search": True}
    
    resp = await client.chat.completions.create(
        model=model or settings.QWEN_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        **extra_params,
    )
    return resp.choices[0].message.content or ""


async def _qwen_stream(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> AsyncIterator[str]:
    """Qwen streaming completion via OpenAI-compatible API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.QWEN_API_KEY,
        base_url=settings.QWEN_BASE_URL,
    )
    
    extra_params = {}
    
    stream = await client.chat.completions.create(
        model=model or settings.QWEN_MODEL_STRONG,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        **extra_params,
    )
    
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


# ── Moonshot Kimi ───────────────────────────────────────────

async def _moonshot_complete(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int,
    enable_search: bool = False,
) -> str:
    """Moonshot Kimi completion via OpenAI-compatible API.

    Note: Kimi K2.5 has fixed temperature=0.6, the parameter is ignored.
    When enable_search=True, uses Kimi's builtin $web_search function (tool_calls loop).
    """
    import json
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.MOONSHOT_API_KEY,
        base_url=settings.MOONSHOT_BASE_URL,
    )

    # K2.5 unified model with thinking control
    extra_params: dict = {
        "extra_body": {"thinking": {"type": "enabled"}}
    }

    # Kimi builtin web search tool declaration
    tools = [
        {
            "type": "builtin_function",
            "function": {"name": "$web_search"},
        }
    ] if enable_search else None

    # Mutable copy of messages for the tool_calls loop
    msgs: list = list(messages)

    while True:
        call_kwargs: dict = dict(
            model=model or settings.MOONSHOT_MODEL_STRONG,
            messages=msgs,
            max_tokens=max_tokens,
            **extra_params,
        )
        if tools:
            call_kwargs["tools"] = tools

        resp = await client.chat.completions.create(**call_kwargs)
        choice = resp.choices[0]

        if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
            # Kimi executed a web search — pass results back unchanged
            msgs.append(choice.message)  # assistant message with tool_calls
            for tool_call in choice.message.tool_calls:
                tool_args = json.loads(tool_call.function.arguments)
                msgs.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_call.function.name,
                    # For $web_search, echo back arguments as-is; Kimi executes internally
                    "content": json.dumps(tool_args),
                })
            # Continue loop so Kimi can process search results
        else:
            # finish_reason == "stop" — final answer ready
            return choice.message.content or ""


async def _moonshot_stream(
    messages: list[dict], model: str | None, temperature: float, max_tokens: int
) -> AsyncIterator[str]:
    """Moonshot Kimi streaming completion via OpenAI-compatible API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=settings.MOONSHOT_API_KEY,
        base_url=settings.MOONSHOT_BASE_URL,
    )
    
    extra_params = {
        "extra_body": {"thinking": {"type": "enabled"}}
    }
    
    stream = await client.chat.completions.create(
        model=model or settings.MOONSHOT_MODEL_STRONG,
        messages=messages,
        max_tokens=max_tokens,
        stream=True,
        **extra_params,
    )
    
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content
