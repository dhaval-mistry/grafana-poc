"""Shared PostgreSQL connection factory used by all API endpoints.

The application connects as banking_app (a restricted database role), not the
administrative role. The password is read from a mounted Docker secret.
Timeouts bound slow queries and lock waits; they do not make payments retry-safe.
"""

from pathlib import Path

import psycopg


SECRET_PATH = Path("/run/secrets/banking_app_password")


def get_connection():
    """Open a connection; callers use ``with get_connection()`` for commit/rollback.

    - connect_timeout: fail if the database cannot be reached within five seconds.
    - statement_timeout: cancel a SQL statement after 15 seconds.
    - lock_timeout: cancel a statement waiting five seconds for a row/other lock.
    - idle_in_transaction_session_timeout: kill abandoned open transactions.

    These are starting values for the lab and need load testing before deployment.
    PostgreSQL reads the session options when each new connection is opened.
    """
    password = SECRET_PATH.read_text(encoding="utf-8-sig").rstrip("\r\n")
    return psycopg.connect(
        host="postgres",
        port=5432,
        dbname="banking_lab",
        user="banking_app",
        password=password,
        connect_timeout=5,
        options=(
            "-c statement_timeout=15000 "
            "-c lock_timeout=5000 "
            "-c idle_in_transaction_session_timeout=30000"
        ),
    )
