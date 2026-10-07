"""
Request-scoped observability context.

Provides safe correlation and session identifiers that can later
be attached to logs, traces, and telemetry.

These identifiers are NOT authentication credentials and must never
be used for authorization decisions.
"""

import re
from contextvars import ContextVar
from uuid import uuid4

from fastapi import Request


MAX_CONTEXT_ID_LENGTH = 128

SAFE_CONTEXT_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
)


correlation_id_context: ContextVar[str | None] = ContextVar(
    "correlation_id",
    default=None,
)


session_id_context: ContextVar[str | None] = ContextVar(
    "session_id",
    default=None,
)


def validate_context_id(
    value: str | None,
) -> str | None:
    """
    Accept only bounded, simple identifiers.

    This prevents arbitrary header text from entering
    telemetry later.
    """

    if not value or len(value) > MAX_CONTEXT_ID_LENGTH:
        return None

    value = value.strip()

    if (
        len(value) > MAX_CONTEXT_ID_LENGTH
        or not SAFE_CONTEXT_ID_PATTERN.fullmatch(value)
    ):
        return None

    return value


def get_correlation_id() -> str | None:
    """
    Return the correlation ID for the current request.
    """

    return correlation_id_context.get()


def get_session_id() -> str | None:
    """
    Return the optional session ID for the current request.
    """

    return session_id_context.get()


async def apply_request_context(
    request: Request,
    call_next,
):
    """
    Establish safe request-scoped observability identifiers.

    X-Correlation-ID:
    - Preserve a valid caller-provided ID.
    - Generate a new UUID if it is missing or invalid.

    X-Session-ID:
    - Preserve only a valid value.
    - Never use it for authentication or authorization.
    """

    incoming_correlation_id = validate_context_id(
        request.headers.get(
            "X-Correlation-ID"
        )
    )

    correlation_id = (
        incoming_correlation_id
        or str(uuid4())
    )


    session_id = validate_context_id(
        request.headers.get(
            "X-Session-ID"
        )
    )


    correlation_token = (
        correlation_id_context.set(
            correlation_id
        )
    )

    session_token = (
        session_id_context.set(
            session_id
        )
    )


    request.state.correlation_id = (
        correlation_id
    )

    request.state.session_id = (
        session_id
    )


    try:
        response = await call_next(
            request
        )

        response.headers[
            "X-Correlation-ID"
        ] = correlation_id

        return response

    finally:
        correlation_id_context.reset(
            correlation_token
        )

        session_id_context.reset(
            session_token
        )
