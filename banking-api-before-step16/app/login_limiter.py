"""Small, process-local login throttle for this single-worker synthetic lab.

Why this exists:
    Password hashing alone cannot stop unlimited online password guesses.
    Five failed requests from one client within five minutes trigger a 429.

Important limitations:
    The counters reset on restart and are NOT shared across API replicas.
    For a deployed system, use a shared store and controls at the gateway.
    We deliberately use request.client.host, not an untrusted forwarded-IP header.
    Client addresses may be shared behind a NAT or reverse proxy.

Privacy:
    Only a client network address and failure timestamps are kept in memory.
    Passwords, usernames and bearer tokens are never stored here.
"""

from collections import deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException


MAX_FAILURES = 5
WINDOW_SECONDS = 300
MAX_TRACKED_CLIENTS = 10_000

# Shared within one Python process. Protect updates because FastAPI sync endpoints
# can execute concurrently in a thread pool.
_failures: dict[str, deque[float]] = {}
_lock = Lock()


def _prune(now: float) -> None:
    """Remove expired entries and keep this in-memory table bounded."""
    for client, times in list(_failures.items()):
        while times and now - times[0] >= WINDOW_SECONDS:
            times.popleft()
        if not times:
            del _failures[client]


def check_login_allowed(client: str) -> None:
    """Reject a client that has hit the failure limit (before expensive hashing)."""
    now = monotonic()
    with _lock:
        _prune(now)
        if len(_failures.get(client, ())) >= MAX_FAILURES:
            # No username is mentioned: the response does not disclose account state.
            raise HTTPException(
                status_code=429,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(WINDOW_SECONDS)},
            )


def record_login_failure(client: str) -> None:
    """Count a rejected credential attempt. This contains no credentials."""
    now = monotonic()
    with _lock:
        _prune(now)
        if client not in _failures and len(_failures) >= MAX_TRACKED_CLIENTS:
            # Fail closed rather than allow unlimited memory consumption.
            raise HTTPException(status_code=503, detail="Authentication temporarily unavailable.")
        _failures.setdefault(client, deque()).append(now)


def clear_login_failures(client: str) -> None:
    """A successful authentication clears this client's recent failures."""
    with _lock:
        _failures.pop(client, None)
