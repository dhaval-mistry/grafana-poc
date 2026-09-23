"""
Step 14.14: Non-destructive API regression tests.

Uses existing synthetic customer accounts.
Does not submit a valid new payment.

Requirements:
- FastAPI running on localhost:8000
- Alex and Jordan already activated
- Their existing test passwords
"""

import getpass
import json
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


BASE_URL = "http://127.0.0.1:8000"

ALEX_CHECKING = "20000000-0000-4000-8000-000000000001"
ALEX_SAVINGS = "20000000-0000-4000-8000-000000000002"

JORDAN_CHECKING = "20000000-0000-4000-8000-000000000003"
JORDAN_SAVINGS = "20000000-0000-4000-8000-000000000004"


def request_api(path, token=None, method="GET", body=None, key=None):
    """Return the HTTP status and parsed response."""

    headers = {}

    if token:
        headers["Authorization"] = f"Bearer {token}"

    if body is not None:
        headers["Content-Type"] = "application/json"

    if key:
        headers["Idempotency-Key"] = key

    request = urllib.request.Request(
        BASE_URL + path,
        data=(
            json.dumps(body).encode("utf-8")
            if body is not None
            else None
        ),
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.load(response)

    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def login(username, password):
    """Log in without printing passwords or tokens."""

    form = urllib.parse.urlencode({
        "username": username,
        "password": password,
    }).encode("utf-8")

    request = urllib.request.Request(
        BASE_URL + "/api/v1/auth/token",
        data=form,
        headers={
            "Content-Type": "application/x-www-form-urlencoded"
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)["access_token"]


def payment_body(source, destination, amount):
    return {
        "source_account_id": source,
        "destination_account_id": destination,
        "amount": amount,
    }


class BankingRegression(unittest.TestCase):

    @classmethod
    def setUpClass(cls):

        print("Enter synthetic test credentials.")
        print("Credentials and JWTs will not be printed.")

        alex_password = getpass.getpass(
            "Alex password: "
        )

        jordan_password = getpass.getpass(
            "Jordan password: "
        )

        cls.alex_token = login(
            "alex.morgan",
            alex_password,
        )

        cls.jordan_token = login(
            "jordan.lee",
            jordan_password,
        )

        # Capture balances and transaction histories.
        # We will ensure this test suite does not change them.
        cls.alex_before = cls.get_accounts(cls.alex_token)
        cls.jordan_before = cls.get_accounts(cls.jordan_token)

        cls.alex_history_before = cls.get_history(
            cls.alex_token,
            ALEX_CHECKING,
        )

        cls.jordan_history_before = cls.get_history(
            cls.jordan_token,
            JORDAN_CHECKING,
        )

    @classmethod
    def tearDownClass(cls):

        alex_after = cls.get_accounts(cls.alex_token)
        jordan_after = cls.get_accounts(cls.jordan_token)

        alex_history_after = cls.get_history(
            cls.alex_token,
            ALEX_CHECKING,
        )

        jordan_history_after = cls.get_history(
            cls.jordan_token,
            JORDAN_CHECKING,
        )

        if (
            cls.alex_before != alex_after
            or cls.jordan_before != jordan_after
            or cls.alex_history_before != alex_history_after
            or cls.jordan_history_before != jordan_history_after
        ):
            raise AssertionError(
                "Account balances or transaction histories changed."
            )

        print("\nNon-destructive verification: PASSED")

    @staticmethod
    def get_accounts(token):

        status, body = request_api(
            "/api/v1/accounts",
            token,
        )

        if status != 200:
            raise RuntimeError(
                "Could not retrieve accounts."
            )

        return body

    @staticmethod
    def get_history(token, account_id):

        status, body = request_api(
            f"/api/v1/accounts/{account_id}/transactions",
            token,
        )

        if status != 200:
            raise RuntimeError(
                "Could not retrieve transaction history."
            )

        return body

    def test_01_missing_authentication(self):

        status, _ = request_api(
            "/api/v1/accounts"
        )

        self.assertEqual(status, 401)

    def test_02_invalid_jwt(self):

        status, _ = request_api(
            "/api/v1/accounts",
            "invalid.jwt.value",
        )

        self.assertEqual(status, 401)

    def test_03_alex_profile(self):

        status, body = request_api(
            "/api/v1/customers/me",
            self.alex_token,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["full_name"], "Alex Morgan")

    def test_04_jordan_profile(self):

        status, body = request_api(
            "/api/v1/customers/me",
            self.jordan_token,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["full_name"], "Jordan Lee")

    def test_05_alex_accounts(self):

        account_ids = {
            account["account_id"]
            for account in self.alex_before
        }

        self.assertEqual(
            account_ids,
            {ALEX_CHECKING, ALEX_SAVINGS},
        )

        for account in self.alex_before:
            self.assertTrue(
                account["masked_account_number"].startswith("****")
            )

    def test_06_jordan_accounts(self):

        account_ids = {
            account["account_id"]
            for account in self.jordan_before
        }

        self.assertEqual(
            account_ids,
            {JORDAN_CHECKING, JORDAN_SAVINGS},
        )

    def test_07_cross_customer_account_access(self):

        status, _ = request_api(
            f"/api/v1/accounts/{JORDAN_CHECKING}/transactions",
            self.alex_token,
        )

        self.assertEqual(status, 404)

    def test_08_invalid_account_identifier(self):

        status, _ = request_api(
            "/api/v1/accounts/not-a-uuid/transactions",
            self.alex_token,
        )

        self.assertEqual(status, 422)

    def test_09_missing_idempotency_key(self):

        status, _ = request_api(
            "/api/v1/payments",
            self.alex_token,
            method="POST",
            body=payment_body(
                ALEX_CHECKING,
                ALEX_SAVINGS,
                "10.00",
            ),
        )

        self.assertEqual(status, 422)

    def test_10_invalid_amount(self):

        status, _ = request_api(
            "/api/v1/payments",
            self.alex_token,
            method="POST",
            body=payment_body(
                ALEX_CHECKING,
                ALEX_SAVINGS,
                "-10.00",
            ),
            key=uuid.uuid4().hex,
        )

        self.assertEqual(status, 422)

    def test_11_same_source_and_destination(self):

        status, _ = request_api(
            "/api/v1/payments",
            self.alex_token,
            method="POST",
            body=payment_body(
                ALEX_CHECKING,
                ALEX_CHECKING,
                "10.00",
            ),
            key=uuid.uuid4().hex,
        )

        self.assertEqual(status, 422)

    def test_12_unauthorized_source(self):

        status, _ = request_api(
            "/api/v1/payments",
            self.alex_token,
            method="POST",
            body=payment_body(
                JORDAN_CHECKING,
                ALEX_SAVINGS,
                "10.00",
            ),
            key=uuid.uuid4().hex,
        )

        self.assertEqual(status, 404)


if __name__ == "__main__":

    unittest.main(verbosity=2)