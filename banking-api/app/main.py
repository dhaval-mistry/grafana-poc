"""Synthetic banking API entry point. Step 16 adds optional telemetry only."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Configure the OpenTelemetry SDK BEFORE the application handles any traffic.
# This does not change any database records or payment business rules.
from app.telemetry import configure_telemetry, instrument_api, telemetry_middleware
configure_telemetry()

from app.auth import router as auth_router
from app.customers import router as customers_router
from app.accounts import router as accounts_router
from app.payments import router as payments_router
from app.security_headers import apply_security_headers

app = FastAPI(
    title="Synthetic Banking API",
    description="Banking application for our observability lab.",
    version="1.0.0",
)

# Keep validation failures generic so FastAPI does not echo sensitive inputs.
@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Invalid request format."})

# Preserve the existing routers and business logic unchanged.
app.include_router(auth_router)
app.include_router(customers_router)
app.include_router(accounts_router)
app.include_router(payments_router)

# Existing cache-control and security headers still apply.
app.middleware("http")(apply_security_headers)
# Observability middleware reads status, approved route template, and timing only.
app.middleware("http")(telemetry_middleware)

@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    """Process readiness only; this does not test PostgreSQL or Alloy."""
    return {"status": "ok"}

# Must be last so its server span wraps the banking middleware and DB operations.
instrument_api(app)
