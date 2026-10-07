"""
Generate a first-time activation token for a synthetic customer.

This is a local administrator utility, not a FastAPI endpoint.
Only the token hash is stored in PostgreSQL.
"""

import argparse
import hashlib
import secrets
from pathlib import Path
from uuid import UUID

import psycopg


# Fixed customer IDs from our synthetic master-data script.
CUSTOMERS = {
    "alex.morgan": UUID("10000000-0000-4000-8000-000000000001"),
    "jordan.lee": UUID("10000000-0000-4000-8000-000000000002"),
    "taylor.brooks": UUID("10000000-0000-4000-8000-000000000003"),
}


def generate_activation(username: str) -> None:

    customer_id = CUSTOMERS[username]

    # Locate the administrator password outside source code.
    project_root = Path(__file__).resolve().parents[2]

    password_file = (
        project_root / ".secrets" / "postgres_password.txt"
    )

    password = password_file.read_text(
        encoding="utf-8-sig"
    ).rstrip("\r\n")

    if not password:
        raise RuntimeError("Administrator password file is empty.")

    # Connect through the PostgreSQL port published to Windows.
    with psycopg.connect(
        host="127.0.0.1",
        port=5432,
        dbname="banking_lab",
        user="banking_admin",
        password=password,
        connect_timeout=5,
    ) as connection:

        with connection.cursor() as cursor:

            # Confirm that the customer exists.
            cursor.execute(
                """
                SELECT 1
                FROM public.customers
                WHERE customer_id = %s
                """,
                (customer_id,),
            )

            if cursor.fetchone() is None:
                raise RuntimeError("Customer does not exist.")

            # Do not generate another activation for an existing user.
            cursor.execute(
                """
                SELECT 1
                FROM public.users
                WHERE customer_id = %s
                """,
                (customer_id,),
            )

            if cursor.fetchone():
                raise RuntimeError("Customer is already activated.")

            # Version 1 permits one activation record per customer.
            # Do not overwrite an existing token automatically.
            cursor.execute(
                """
                SELECT 1
                FROM public.account_activations
                WHERE customer_id = %s
                """,
                (customer_id,),
            )

            if cursor.fetchone():
                raise RuntimeError(
                    "Activation already exists. Stop and review."
                )

            # Generate a cryptographically secure random token.
            token = secrets.token_urlsafe(32)

            # Store only its hash, never the original token.
            token_hash = hashlib.sha256(
                token.encode("utf-8")
            ).hexdigest()

            cursor.execute(
                """
                INSERT INTO public.account_activations
                (
                    customer_id,
                    username,
                    token_hash,
                    expires_at
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    CURRENT_TIMESTAMP + INTERVAL '30 minutes'
                )
                """,
                (customer_id, username, token_hash),
            )

    # The connection context commits the transaction before
    # the token is displayed. Exceptions cause a rollback.
    print("\nActivation created successfully.")
    print("Customer:", username)
    print("Activation token:", token)
    print("Expires in: 30 minutes")
    print("Keep this token private. It cannot be retrieved later.")


if __name__ == "__main__":

    parser = argparse.ArgumentParser(
        description="Generate a customer activation token."
    )

    parser.add_argument(
        "username",
        choices=CUSTOMERS.keys(),
        help="Synthetic customer username",
    )

    args = parser.parse_args()

    generate_activation(args.username)