"""
JWT validation and customer authentication.

Reusable security dependency for protected banking APIs.
"""

from uuid import UUID

import jwt
import psycopg

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.auth import (
    get_jwt_secret,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_AUDIENCE,
)

from app.database import get_connection


# Swagger uses this endpoint to obtain an access token.
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/token"
)


def unauthorized():
    """
    Return a generic authentication error.

    Do not expose token contents or internal user details.
    """

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_customer(
    token: str = Depends(oauth2_scheme),
):
    """
    Validate the JWT and retrieve its associated customer.

    Never trust a customer ID supplied in the request.
    Identity must come from a verified token.
    """

    # Step 1: Verify JWT signature and required claims.
    try:

        payload = jwt.decode(
            token,
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={
                "require": [
                    "sub",
                    "exp",
                    "iat",
                    "iss",
                    "aud",
                ]
            },
        )

        # The subject must be a valid internal user UUID.
        user_id = UUID(payload["sub"])

    except jwt.InvalidTokenError:
        unauthorized()

    except (ValueError, TypeError, AttributeError):
        unauthorized()

    except (OSError, RuntimeError):
        raise HTTPException(
            status_code=503,
            detail="Authentication service temporarily unavailable.",
        ) from None

    # Step 2: Verify that the user still exists and is active.
    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                cursor.execute(
                    """
                    SELECT
                        c.customer_id,
                        c.full_name,
                        c.email,
                        c.phone,
                        c.date_of_birth,
                        c.address
                    FROM public.users u
                    JOIN public.customers c
                        ON u.customer_id = c.customer_id
                    WHERE u.user_id = %s
                        AND u.is_active = TRUE
                    """,
                    (user_id,),
                )

                customer = cursor.fetchone()

    except (psycopg.Error, OSError):

        # Never expose database exceptions to API clients.
        raise HTTPException(
            status_code=503,
            detail="Authentication service temporarily unavailable.",
        ) from None

    if customer is None:
        unauthorized()

    # Return only the authenticated customer's profile.
    return {
        "customer_id": customer[0],
        "full_name": customer[1],
        "email": customer[2],
        "phone": customer[3],
        "date_of_birth": customer[4],
        "address": customer[5],
    }