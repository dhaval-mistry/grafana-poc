"""
Synthetic banking payment APIs.

Features:
- JWT authentication
- Source account ownership verification
- Synchronous USD transfers
- Atomic database transactions
- Account row locking
- Idempotency protection
- Insufficient-funds handling
- Restricted payment-status retrieval

This application uses synthetic data only.
"""

import hashlib
import re

from datetime import datetime
from decimal import Decimal
from uuid import UUID

import psycopg

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Response,
    status,
)

from fastapi.responses import JSONResponse

from pydantic import BaseModel, field_validator

from app.database import get_connection
from app.security import get_current_customer


router = APIRouter(
    prefix="/api/v1/payments",
    tags=["Payments"],
)


# =====================================================
# REQUEST AND RESPONSE MODELS
# =====================================================

class PaymentRequest(BaseModel):

    source_account_id: UUID

    destination_account_id: UUID

    amount: Decimal

    # Validation runs before database access. In particular, JSON numbers are
    # rejected: a string such as "100.00" avoids binary float rounding.
    @field_validator("amount", mode="before")
    @classmethod
    def validate_amount(cls, value):

        # Require a string to avoid floating-point input.
        # NUMERIC(18,2) supports up to 16 integer digits.
        if not isinstance(value, str):
            raise ValueError(
                "Amount must be a decimal string."
            )

        if not re.fullmatch(
            r"(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?",
            value,
        ):
            raise ValueError("Invalid USD amount.")

        amount = Decimal(value)

        if amount <= 0:
            raise ValueError("Amount must be positive.")

        return amount


class PaymentResponse(BaseModel):

    payment_id: UUID

    amount: Decimal

    status: str

    error_code: str | None

    created_at: datetime

    completed_at: datetime


# =====================================================
# HELPERS
# =====================================================

def payment_from_row(row):

    """
    Convert a database payment into a safe response.

    Do not include account numbers, customer names,
    idempotency keys or other sensitive details.
    """

    return PaymentResponse(
        payment_id=row[0],
        amount=row[3],
        status=row[4],
        error_code=row[5],
        created_at=row[6],
        completed_at=row[7],
    )


def payment_error(status_code, message):

    raise HTTPException(
        status_code=status_code,
        detail=message,
    )


def find_existing_payment(cursor, user_id, key):

    cursor.execute(
        """
        SELECT
            payment_id,
            source_account_id,
            destination_account_id,
            amount,
            status,
            error_code,
            created_at,
            completed_at
        FROM public.payments
        WHERE initiated_by_user_id = %s
            AND idempotency_key = %s
        """,
        (user_id, key),
    )

    return cursor.fetchone()


def lock_account(cursor, account_id):

    """
    Lock an account row until the transaction ends.

    This prevents another transfer from simultaneously
    modifying the same account balance.
    """

    cursor.execute(
        """
        SELECT
            account_id,
            customer_id,
            balance,
            is_active,
            currency
        FROM public.accounts
        WHERE account_id = %s
        FOR UPDATE
        """,
        (account_id,),
    )

    return cursor.fetchone()


# =====================================================
# POST /api/v1/payments
# =====================================================

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=PaymentResponse,
)
def create_payment(
    request: PaymentRequest,
    response: Response,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=16,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
    ),
    customer: dict = Depends(get_current_customer),
):

    """
    Execute an internal transfer.

    All balance updates and ledger entries must either
    commit together or roll back together.
    """

    customer_id = customer["customer_id"]

    source_id = request.source_account_id

    destination_id = request.destination_account_id

    amount = request.amount

    # A transfer to the same account is invalid.
    if source_id == destination_id:
        payment_error(
            422,
            "Source and destination must be different.",
        )

    replayed = False

    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                # Find the authenticated customer's user ID.
                cursor.execute(
                    """
                    SELECT user_id
                    FROM public.users
                    WHERE customer_id = %s
                        AND is_active = TRUE
                    """,
                    (customer_id,),
                )

                user = cursor.fetchone()

                if user is None:
                    payment_error(401, "Unauthorized.")

                user_id = user[0]

                # Never lock on a client-supplied account number here: the JWT
                # establishes the user identity, and the database verifies
                # ownership of the source account below.
                # Serialize requests using the same customer
                # and idempotency key.
                #
                # Hashing provides a fixed-size advisory-lock
                # identifier. The database also enforces the
                # unique idempotency constraint.
                lock_value = hashlib.sha256(
                    (
                        str(user_id)
                        + ":"
                        + idempotency_key
                    ).encode("utf-8")
                ).digest()

                lock_number = int.from_bytes(
                    lock_value[:8],
                    byteorder="big",
                    signed=True,
                )

                cursor.execute(
                    "SELECT pg_advisory_xact_lock(%s)",
                    (lock_number,),
                )

                # -------------------------------------------------
                # Duplicate payment detection
                # -------------------------------------------------

                existing = find_existing_payment(
                    cursor,
                    user_id,
                    idempotency_key,
                )

                if existing is not None:

                    # Same key with different payment details
                    # must never execute another transfer.
                    if (
                        existing[1] != source_id
                        or existing[2] != destination_id
                        or existing[3] != amount
                    ):
                        payment_error(
                            409,
                            "Idempotency key already used "
                            "for a different request.",
                        )

                    replayed = True

                    outcome = payment_from_row(existing)

                else:

                    # -------------------------------------------------
                    # Lock accounts in a consistent order.
                    # This helps avoid deadlocks.
                    # -------------------------------------------------

                    locked_accounts = {}

                    for account_id in sorted(
                        [source_id, destination_id],
                        key=str,
                    ):

                        account = lock_account(
                            cursor,
                            account_id,
                        )

                        if account is None:
                            payment_error(
                                404,
                                "Account not found.",
                            )

                        locked_accounts[account_id] = account

                    source = locked_accounts[source_id]

                    destination = locked_accounts[destination_id]

                    # -------------------------------------------------
                    # Validate account access and eligibility.
                    # -------------------------------------------------

                    if (
                        source[1] != customer_id
                        or not source[3]
                    ):
                        payment_error(
                            404,
                            "Account not found.",
                        )

                    if not destination[3]:
                        payment_error(
                            404,
                            "Account not found.",
                        )

                    if (
                        source[4] != "USD"
                        or destination[4] != "USD"
                    ):
                        payment_error(
                            409,
                            "Unsupported currency.",
                        )

                    # -------------------------------------------------
                    # Determine payment outcome.
                    # -------------------------------------------------

                    insufficient_funds = source[2] < amount

                    payment_status = (
                        "rejected"
                        if insufficient_funds
                        else "completed"
                    )

                    error_code = (
                        "INSUFFICIENT_FUNDS"
                        if insufficient_funds
                        else None
                    )

                    # Payment insertion, balance updates and ledger entries are
                    # in ONE connection context. Any uncaught exception before
                    # leaving the context rolls the entire transaction back.
                    # Save the payment outcome.
                    cursor.execute(
                        """
                        INSERT INTO public.payments
                        (
                            initiated_by_user_id,
                            source_account_id,
                            destination_account_id,
                            amount,
                            status,
                            error_code,
                            idempotency_key
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s, %s
                        )
                        RETURNING
                            payment_id,
                            source_account_id,
                            destination_account_id,
                            amount,
                            status,
                            error_code,
                            created_at,
                            completed_at
                        """,
                        (
                            user_id,
                            source_id,
                            destination_id,
                            amount,
                            payment_status,
                            error_code,
                            idempotency_key,
                        ),
                    )

                    payment_row = cursor.fetchone()

                    payment_id = payment_row[0]

                    # -------------------------------------------------
                    # Insufficient funds:
                    # Retain the rejected payment, but do not
                    # update balances or create transactions.
                    # -------------------------------------------------

                    if not insufficient_funds:

                        # Debit source account.
                        cursor.execute(
                            """
                            UPDATE public.accounts
                            SET balance = balance - %s
                            WHERE account_id = %s
                                AND balance >= %s
                            RETURNING balance
                            """,
                            (amount, source_id, amount),
                        )

                        if cursor.fetchone() is None:
                            payment_error(
                                503,
                                "Payment processing unavailable.",
                            )

                        # Credit destination account.
                        cursor.execute(
                            """
                            UPDATE public.accounts
                            SET balance = balance + %s
                            WHERE account_id = %s
                            """,
                            (amount, destination_id),
                        )

                        # Record source debit.
                        cursor.execute(
                            """
                            INSERT INTO public.transactions
                            (
                                payment_id,
                                account_id,
                                entry_type,
                                amount
                            )
                            VALUES (%s, %s, 'debit', %s)
                            """,
                            (payment_id, source_id, amount),
                        )

                        # Record destination credit.
                        cursor.execute(
                            """
                            INSERT INTO public.transactions
                            (
                                payment_id,
                                account_id,
                                entry_type,
                                amount
                            )
                            VALUES (%s, %s, 'credit', %s)
                            """,
                            (payment_id, destination_id, amount),
                        )

                    outcome = payment_from_row(payment_row)

        # At this point, the database transaction has committed.
        # Do not raise the insufficient-funds exception before
        # committing, or its payment record would roll back.

    except (psycopg.Error, OSError):

        payment_error(
            503,
            "Payment service temporarily unavailable.",
        )

    # Return the same stored rejection on an identical retry.
    if outcome.status == "rejected":

        return JSONResponse(
            status_code=409,
            content=outcome.model_dump(mode="json"),
        )

    # A successful duplicate returns the original payment
    # without executing a second transfer.
    if replayed:
        response.status_code = 200

    return outcome


# =====================================================
# GET /api/v1/payments/{payment_id}
# =====================================================

@router.get(
    "/{payment_id}",
    response_model=PaymentResponse,
)
def get_payment(
    payment_id: UUID,
    customer: dict = Depends(get_current_customer),
):

    """
    Retrieve an authorized payment.

    The source owner can retrieve their payment.
    The destination owner can retrieve completed payments.

    Rejected payments remain visible only to the sender.
    """

    customer_id = customer["customer_id"]

    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                cursor.execute(
                    """
                    SELECT
                        p.payment_id,
                        p.source_account_id,
                        p.destination_account_id,
                        p.amount,
                        p.status,
                        p.error_code,
                        p.created_at,
                        p.completed_at
                    FROM public.payments p

                    JOIN public.accounts source
                        ON p.source_account_id =
                            source.account_id

                    JOIN public.accounts destination
                        ON p.destination_account_id =
                            destination.account_id

                    WHERE p.payment_id = %s
                        AND (
                            source.customer_id = %s
                            OR (
                                p.status = 'completed'
                                AND destination.customer_id = %s
                            )
                        )
                    """,
                    (
                        payment_id,
                        customer_id,
                        customer_id,
                    ),
                )

                payment = cursor.fetchone()

    except (psycopg.Error, OSError):

        payment_error(
            503,
            "Payment service temporarily unavailable.",
        )

    if payment is None:

        payment_error(
            404,
            "Payment not found.",
        )

    return payment_from_row(payment)