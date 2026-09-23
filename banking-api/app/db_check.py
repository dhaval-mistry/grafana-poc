from pathlib import Path

import psycopg


def check_database_connection():
    """
    Verify that FastAPI can reach PostgreSQL.

    Read the database password from the Docker secret.
    Never print credentials or connection details containing secrets.
    """

    password = Path(
        "/run/secrets/banking_app_password"
    ).read_text(encoding="utf-8").strip()

    # Docker resolves "postgres" to the PostgreSQL container.
    # Connect using the restricted application account.
    with psycopg.connect(
        host="postgres",
        port=5432,
        dbname="banking_lab",
        user="banking_app",
        password=password,
        connect_timeout=5,
    ) as connection:

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_database(), current_user;"
            )

            database, user = cursor.fetchone()

            print("Database connection successful")
            print(f"Database: {database}")
            print(f"User: {user}")


if __name__ == "__main__":
    check_database_connection()