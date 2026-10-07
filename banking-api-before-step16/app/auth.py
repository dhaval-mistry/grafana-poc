"""
First-time customer account activation.

A customer must provide a valid activation token before
creating their login credentials.

This endpoint is restricted to our local synthetic lab.
"""

import hashlib
import hmac

import psycopg

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, SecretStr
from pwdlib import PasswordHash

from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt

from fastapi import Depends
from fastapi.security import OAuth2PasswordRequestForm

from app.database import get_connection
from app.login_limiter import (
    check_login_allowed,
    clear_login_failures,
    record_login_failure,
)


router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Authentication"],
)

# Argon2 password hashing.
password_hasher = PasswordHash.recommended()

INVALID_ACTIVATION = "Invalid or expired activation request."

# JWT configuration for our local banking lab.
# The signing key is provided through a Docker secret.
JWT_SECRET_PATH = Path("/run/secrets/jwt_secret")

JWT_ALGORITHM = "HS256"

JWT_ISSUER = "synthetic-banking-api"

JWT_AUDIENCE = "synthetic-banking-api"

ACCESS_TOKEN_MINUTES = 30


def get_jwt_secret() -> str:
    """
    Load the JWT signing key from Docker secrets.

    Never print the signing key or include it in logs.
    """

    secret = JWT_SECRET_PATH.read_text(
        encoding="utf-8"
    ).strip()

    if len(secret) < 32:
        raise RuntimeError(
            "JWT signing key is missing or too short."
        )

    return secret


class ActivationRequest(BaseModel):
    username: str
    activation_token: SecretStr
    new_password: SecretStr


class ActivationResponse(BaseModel):
    message: str


def reject_activation():
    """
    Return the same error for invalid, expired,
    consumed or otherwise unusable activation tokens.
    """

    raise HTTPException(
        status_code=400,
        detail=INVALID_ACTIVATION,
    )


@router.post(
    "/activate",
    status_code=status.HTTP_201_CREATED,
    response_model=ActivationResponse,
)
def activate_customer(request: ActivationRequest):

    """
    Activate a synthetic customer account.

    User creation and token consumption must either
    both succeed or both roll back.
    """

    username = request.username

    token = request.activation_token.get_secret_value()

    new_password = request.new_password.get_secret_value()

    # Validate password length without returning its value.
    if not 12 <= len(new_password) <= 128:
        raise HTTPException(
            status_code=422,
            detail="Password must contain 12 to 128 characters.",
        )

    # The original activation token is never stored.
    token_hash = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    try:

        # Successful exit commits the transaction.
        # Any exception rolls it back.
        with get_connection() as connection:

            with connection.cursor() as cursor:

                # Find the activation record for this username.
                cursor.execute(
                    """
                    SELECT
                        activation_id,
                        token_hash
                    FROM public.account_activations
                    WHERE username = %s
                    """,
                    (username,),
                )

                activation = cursor.fetchone()

                if activation is None:
                    reject_activation()

                activation_id, stored_hash = activation

                # Constant-time comparison avoids ordinary
                # string comparison of security tokens.
                if not hmac.compare_digest(
                    token_hash,
                    stored_hash,
                ):
                    reject_activation()

                # Hash the password before storing it.
                password_hash = password_hasher.hash(
                    new_password
                )

                # Claim the token only if it is unused
                # and has not expired.
                #
                # This conditional update also prevents
                # two simultaneous requests from using it.
                cursor.execute(
                    """
                    UPDATE public.account_activations
                    SET used_at = CURRENT_TIMESTAMP
                    WHERE activation_id = %s
                        AND used_at IS NULL
                        AND expires_at > CURRENT_TIMESTAMP
                    RETURNING customer_id, username
                    """,
                    (activation_id,),
                )

                claimed = cursor.fetchone()

                if claimed is None:
                    reject_activation()

                customer_id, reserved_username = claimed

                # Create the user's credentials.
                # PostgreSQL generates user_id automatically.
                cursor.execute(
                    """
                    INSERT INTO public.users
                    (
                        customer_id,
                        username,
                        password_hash
                    )
                    VALUES (%s, %s, %s)
                    """,
                    (
                        customer_id,
                        reserved_username,
                        password_hash,
                    ),
                )

    except psycopg.errors.UniqueViolation:

        # A user may already exist.
        # Do not reveal account state to the caller.
        reject_activation()

    except (psycopg.Error, OSError):

        # Never return database errors or credentials.
        raise HTTPException(
            status_code=503,
            detail="Activation service temporarily unavailable.",
        ) from None

    return ActivationResponse(
        message="Account activated successfully"
    )

# =====================================================
# CUSTOMER LOGIN
# =====================================================


class TokenResponse(BaseModel):
    """
    Standard OAuth2-compatible access token response.
    """

    access_token: str
    token_type: str
    expires_in: int


def invalid_credentials():
    """
    Return the same response for an unknown username,
    incorrect password or inactive user.
    """

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post(
    "/token",
    response_model=TokenResponse,
)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """
    Authenticate a customer and issue a signed JWT.

    Password verification uses the Argon2 hash stored
    during first-time account activation.
    """

    # Use the connection address, not X-Forwarded-For: a client can forge that
    # header when no trusted reverse-proxy configuration has been established.
    # The local lab runs one Uvicorn worker; counters are not shared across workers.
    client = request.client.host if request.client else "unknown"
    check_login_allowed(client)

    username = form_data.username
    password = form_data.password

    # Retrieve only the fields required for authentication.
    # Customer sensitive information is not needed here.
    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                cursor.execute(
                    """
                    SELECT
                        user_id,
                        password_hash,
                        is_active
                    FROM public.users
                    WHERE username = %s
                    """,
                    (username,),
                )

                user = cursor.fetchone()

    except (psycopg.Error, OSError):

        # Do not expose database errors to the caller.
        raise HTTPException(
            status_code=503,
            detail="Authentication service temporarily unavailable.",
        ) from None

    # Reject unknown users without exposing whether
    # the username exists in our database.
    if user is None:
        record_login_failure(client)
        invalid_credentials()

    user_id, stored_hash, is_active = user

    if not is_active:
        record_login_failure(client)
        invalid_credentials()

    # Verify the supplied password against its stored hash.
    # Never compare plaintext passwords directly.
    if not password_hasher.verify(
        password,
        stored_hash,
    ):
        record_login_failure(client)
        invalid_credentials()

    # A successful password verification removes this client's failure counter.
    # Do not log credentials or the JWT that we generate below.
    clear_login_failures(client)

    # Use timezone-aware timestamps.
    now = datetime.now(timezone.utc)

    expires_at = now + timedelta(
        minutes=ACCESS_TOKEN_MINUTES
    )

    # JWT payload contains no customer personal data.
    payload = {
        "sub": str(user_id),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": now,
        "exp": expires_at,
    }

    try:

        # Sign the token using our private Docker secret.
        access_token = jwt.encode(
            payload,
            get_jwt_secret(),
            algorithm=JWT_ALGORITHM,
        )

    except (OSError, RuntimeError):

        raise HTTPException(
            status_code=503,
            detail="Authentication service temporarily unavailable.",
        ) from None

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_MINUTES * 60,
    )