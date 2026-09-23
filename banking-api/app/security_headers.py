"""Small HTTP response-header policy for the local synthetic banking API.

These headers are not a replacement for HTTPS or proper authentication.
We set them on normal and handled-error responses, including token responses.
"""

from fastapi import Request
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response


async def apply_security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Call the existing route, then prevent sensitive responses being cached."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
