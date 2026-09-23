-- Migration 001: Customer identity and authentication
-- Purpose: Store synthetic customer information and login details.
-- Execute using banking_admin, not banking_app.

CREATE TABLE customers (

    customer_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    full_name VARCHAR(150) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    phone VARCHAR(30) NOT NULL,

    date_of_birth DATE NOT NULL,

    address TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);


-- Each synthetic customer has one login account.
-- Passwords must be hashed in FastAPI before being stored.
-- Never store plaintext passwords in this table.

CREATE TABLE users (

    user_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    customer_id UUID NOT NULL UNIQUE,

    username VARCHAR(100) NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)

);