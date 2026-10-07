"""
Synthetic Banking API.

Main application entry point.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

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


# Prevent malformed requests from echoing sensitive
# request values in validation error responses.
@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request,
    exc: RequestValidationError,
):
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request format."},
    )


# Register customer authentication endpoints.
app.include_router(auth_router)
app.include_router(customers_router)
app.include_router(accounts_router)
app.include_router(payments_router)
app.middleware("http")(apply_security_headers)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:

    """
    Confirm that the application is running.

    Database connectivity is not included in this
    lightweight health check.
    """

    return {"status": "ok"}