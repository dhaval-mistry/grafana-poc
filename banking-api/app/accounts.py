"""
Account and transaction history APIs.

Security:
- Customer identity comes from the verified JWT.
- Customers can only access their own accounts.
- Account numbers are masked in API responses.
- Database errors never expose sensitive information.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

import psycopg

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_connection
from app.security import get_current_customer


router = APIRouter(
    prefix="/api/v1/accounts",
    tags=["Accounts"],
)


# =====================================================
# RESPONSE MODELS
# =====================================================

class AccountResponse(BaseModel):
    account_id: UUID
    account_type: str
    masked_account_number: str
    balance: Decimal
    currency: str


class TransactionResponse(BaseModel):
    transaction_id: UUID
    payment_id: UUID
    entry_type: str
    amount: Decimal
    created_at: datetime


# =====================================================
# HELPER FUNCTIONS
# =====================================================

def mask_account_number(account_number: str) -> str:
    """
    Display only the final four characters.

    Example:
    LAB-000001 becomes ****0001.
    """

    return "****" + account_number[-4:]


def database_error():
    """
    Return a generic database error.

    Never expose SQL statements or customer information.
    """

    raise HTTPException(
        status_code=503,
        detail="Banking service temporarily unavailable.",
    )


# =====================================================
# GET MY ACCOUNTS
# =====================================================

@router.get(
    "",
    response_model=list[AccountResponse],
)
def get_my_accounts(
    customer: dict = Depends(get_current_customer),
):
    """
    Retrieve accounts owned by the authenticated customer.

    Customer ID is derived from the verified JWT.
    """

    customer_id = customer["customer_id"]

    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                cursor.execute(
                    """
                    SELECT
                        account_id,
                        account_number,
                        account_type,
                        balance,
                        currency
                    FROM public.accounts
                    WHERE customer_id = %s
                    ORDER BY account_type, account_id
                    """,
                    (customer_id,),
                )

                rows = cursor.fetchall()

    except (psycopg.Error, OSError):
        database_error()

    # Return masked account numbers.
    # Never return the original account number.
    return [
        AccountResponse(
            account_id=row[0],
            masked_account_number=mask_account_number(
                row[1]
            ),
            account_type=row[2],
            balance=row[3],
            currency=row[4],
        )
        for row in rows
    ]


# =====================================================
# GET ACCOUNT TRANSACTION HISTORY
# =====================================================

@router.get(
    "/{account_id}/transactions",
    response_model=list[TransactionResponse],
)
def get_account_transactions(
    account_id: UUID,
    customer: dict = Depends(get_current_customer),
):
    """
    Retrieve transaction history for an owned account.

    Return HTTP 404 for both nonexistent and unauthorized
    accounts to avoid revealing account existence.
    """

    customer_id = customer["customer_id"]

    try:

        with get_connection() as connection:

            with connection.cursor() as cursor:

                # Verify ownership before retrieving transactions.
                cursor.execute(
                    """
                    SELECT 1
                    FROM public.accounts
                    WHERE account_id = %s
                        AND customer_id = %s
                    """,
                    (account_id, customer_id),
                )

                if cursor.fetchone() is None:

                    raise HTTPException(
                        status_code=404,
                        detail="Account not found.",
                    )

                # Retrieve entries only for the authorized account.
                cursor.execute(
                    """
                    SELECT
                        transaction_id,
                        payment_id,
                        entry_type,
                        amount,
                        created_at
                    FROM public.transactions
                    WHERE account_id = %s
                    ORDER BY created_at DESC, transaction_id DESC
                    """,
                    (account_id,),
                )

                rows = cursor.fetchall()

    except (psycopg.Error, OSError):
        database_error()

    return [
        TransactionResponse(
            transaction_id=row[0],
            payment_id=row[1],
            entry_type=row[2],
            amount=row[3],
            created_at=row[4],
        )
        for row in rows
    ]