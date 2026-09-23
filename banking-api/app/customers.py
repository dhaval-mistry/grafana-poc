"""
Customer profile API.

Only authenticated customers can retrieve their own profile.
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.security import get_current_customer


router = APIRouter(
    prefix="/api/v1/customers",
    tags=["Customers"],
)


class CustomerProfile(BaseModel):
    customer_id: UUID
    full_name: str
    email: str
    phone: str
    date_of_birth: date
    address: str


@router.get(
    "/me",
    response_model=CustomerProfile,
)
def get_my_profile(
    customer: dict = Depends(get_current_customer),
):
    """
    Return the authenticated customer's profile.

    Customer identity comes from the verified JWT,
    not from a customer ID supplied by the caller.
    """

    return customer