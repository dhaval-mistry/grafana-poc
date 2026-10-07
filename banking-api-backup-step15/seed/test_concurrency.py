"""
Concurrent payment test for the synthetic banking lab.

Scenario:
- Jordan starts with $5,050 in checking.
- Two simultaneous requests attempt to transfer $3,000 each.
- Exactly one transfer should complete.

This script creates real synthetic payment records.
Run it only once against the expected starting balances.
"""

import getpass
import json
import threading
import uuid

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "http://127.0.0.1:8000"

SOURCE = "20000000-0000-4000-8000-000000000003"
DESTINATION = "20000000-0000-4000-8000-000000000004"

AMOUNT = "3000.00"

EXPECTED_SOURCE = Decimal("5050.00")
EXPECTED_DESTINATION = Decimal("15000.00")


def api_request(path, token, method="GET", body=None, key=None):
    """Send an API request without printing credentials."""

    headers = {
        "Authorization": f"Bearer {token}",
    }

    if body is not None:
        headers["Content-Type"] = "application/json"

    if key:
        headers["Idempotency-Key"] = key

    request = Request(
        BASE_URL + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )

    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)

    except HTTPError as error:
        return error.code, json.load(error)


def login():
    """Authenticate Jordan without displaying his password or JWT."""

    password = getpass.getpass(
        "Enter Jordan's test password: "
    )

    request = Request(
        BASE_URL + "/api/v1/auth/token",
        data=urlencode({
            "username": "jordan.lee",
            "password": password,
        }).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded"
        },
        method="POST",
    )

    with urlopen(request, timeout=10) as response:
        return json.load(response)["access_token"]


def get_balances(token):
    """Read Jordan's balances through the protected API."""

    status, accounts = api_request(
        "/api/v1/accounts",
        token,
    )

    if status != 200:
        raise RuntimeError("Account retrieval failed.")

    return {
        account["account_id"]: Decimal(str(account["balance"]))
        for account in accounts
    }


def get_history(token, account_id):
    status, history = api_request(
        f"/api/v1/accounts/{account_id}/transactions",
        token,
    )

    if status != 200:
        raise RuntimeError("Transaction history retrieval failed.")

    return history


def send_payment(token, barrier):
    """
    Wait until both worker threads are ready.

    Each request gets a different idempotency key.
    """

    body = {
        "source_account_id": SOURCE,
        "destination_account_id": DESTINATION,
        "amount": AMOUNT,
    }

    barrier.wait(timeout=10)

    return api_request(
        "/api/v1/payments",
        token,
        method="POST",
        body=body,
        key=uuid.uuid4().hex,
    )


def main():

    token = login()

    # Safety: verify balances before creating payments.
    before = get_balances(token)

    if (
        before.get(SOURCE) != EXPECTED_SOURCE
        or before.get(DESTINATION) != EXPECTED_DESTINATION
    ):
        print("STOP: Starting balances do not match.")
        print("No payments submitted.")
        return

    source_history_before = get_history(token, SOURCE)
    destination_history_before = get_history(token, DESTINATION)

    print("Starting balances verified.")
    print("Submitting two concurrent payments...")

    # Two workers plus the main thread.
    barrier = threading.Barrier(3)

    with ThreadPoolExecutor(max_workers=2) as executor:

        first = executor.submit(
            send_payment, token, barrier
        )

        second = executor.submit(
            send_payment, token, barrier
        )

        # Release both workers together.
        barrier.wait(timeout=10)

        results = [
            first.result(),
            second.result(),
        ]

    print("\nPayment results:")

    for status, body in results:
        print(
            "HTTP:",
            status,
            "Payment status:",
            body.get("status"),
            "Error code:",
            body.get("error_code"),
        )

    # Verify exactly one completion and one rejection.
    completed = [
        body for status, body in results
        if status == 201 and body.get("status") == "completed"
    ]

    rejected = [
        body for status, body in results
        if (
            status == 409
            and body.get("status") == "rejected"
            and body.get("error_code") == "INSUFFICIENT_FUNDS"
        )
    ]

    after = get_balances(token)

    source_history_after = get_history(token, SOURCE)
    destination_history_after = get_history(token, DESTINATION)

    balances_ok = (
        after.get(SOURCE) == Decimal("2050.00")
        and after.get(DESTINATION) == Decimal("18000.00")
    )

    histories_ok = (
        len(source_history_after) == len(source_history_before) + 1
        and len(destination_history_after)
        == len(destination_history_before) + 1
    )

    print("\nVerification:")

    print("Exactly one completed:", len(completed) == 1)
    print("Exactly one rejected:", len(rejected) == 1)
    print("Balances correct:", balances_ok)
    print("Transaction counts correct:", histories_ok)

    passed = (
        len(completed) == 1
        and len(rejected) == 1
        and balances_ok
        and histories_ok
    )

    print("\nFINAL RESULT:", "PASSED" if passed else "FAILED")


if __name__ == "__main__":
    main()