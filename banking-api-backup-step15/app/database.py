"""
Database connection configuration.

Credentials are loaded from Docker secrets.
Never store database passwords in application source code.
"""

from pathlib import Path

import psycopg


SECRET_PATH = Path("/run/secrets/banking_app_password")


def get_connection():
    """
    Open a PostgreSQL connection using the restricted
    banking_app account.
    """

    password = SECRET_PATH.read_text(
        encoding="utf-8-sig"
    ).rstrip("\r\n")

    return psycopg.connect(
        host="postgres",
        port=5432,
        dbname="banking_lab",
        user="banking_app",
        password=password,
        connect_timeout=5,
    )