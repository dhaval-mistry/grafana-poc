-- =====================================================
-- Migration 002: Synthetic Banking Schema
-- Creates accounts, payments, and transactions.
-- Execute using banking_admin.
-- No actual banking or customer data is inserted.
-- =====================================================


-- 1. SAFETY CHECK
-- Require migration 001 to be recorded.
-- Stop if migration 002 or any target table already exists.

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '001'
            AND status IN ('baselined', 'applied')
    ) THEN
        RAISE EXCEPTION 'Migration 001 is not recorded';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '002'
    ) THEN
        RAISE EXCEPTION 'Migration 002 already recorded';
    END IF;

    IF to_regclass('public.accounts') IS NOT NULL
       OR to_regclass('public.payments') IS NOT NULL
       OR to_regclass('public.transactions') IS NOT NULL
    THEN
        RAISE EXCEPTION 'One or more banking tables already exist';
    END IF;

END $$;


-- =====================================================
-- 2. ACCOUNTS
-- Each customer may own multiple accounts.
-- Only USD checking and savings accounts are supported.
-- =====================================================

CREATE TABLE public.accounts (

    account_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    customer_id UUID NOT NULL
        REFERENCES public.customers(customer_id),

    account_number VARCHAR(24) NOT NULL UNIQUE,

    account_type VARCHAR(20) NOT NULL
        CHECK (account_type IN ('checking', 'savings')),

    balance NUMERIC(18,2) NOT NULL
        DEFAULT 0.00
        CHECK (balance >= 0),

    currency VARCHAR(3) NOT NULL
        DEFAULT 'USD'
        CHECK (currency = 'USD'),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);

CREATE INDEX idx_accounts_customer
    ON public.accounts(customer_id);


-- =====================================================
-- 3. PAYMENTS
-- Stores successful and rejected payment attempts.
--
-- An idempotency key prevents duplicate payment records
-- for the same initiating user.
-- Application logic must also compare request contents.
-- =====================================================

CREATE TABLE public.payments (

    payment_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    initiated_by_user_id UUID NOT NULL
        REFERENCES public.users(user_id),

    source_account_id UUID NOT NULL
        REFERENCES public.accounts(account_id),

    destination_account_id UUID NOT NULL
        REFERENCES public.accounts(account_id),

    amount NUMERIC(18,2) NOT NULL
        CHECK (amount > 0),

    status VARCHAR(20) NOT NULL
        CHECK (status IN ('completed', 'rejected')),

    error_code VARCHAR(50),

    idempotency_key VARCHAR(100) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    completed_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_different_accounts
        CHECK (source_account_id <> destination_account_id),

    CONSTRAINT chk_payment_outcome
        CHECK (
            (status = 'completed' AND error_code IS NULL)
            OR
            (status = 'rejected' AND error_code IS NOT NULL)
        ),

    CONSTRAINT uq_payment_idempotency
        UNIQUE (initiated_by_user_id, idempotency_key)

);

CREATE INDEX idx_payments_source
    ON public.payments(source_account_id);

CREATE INDEX idx_payments_destination
    ON public.payments(destination_account_id);


-- =====================================================
-- 4. TRANSACTIONS
-- Each successful transfer creates two entries:
-- one debit and one credit.
--
-- The unique constraint prevents duplicate entries
-- of the same type for an individual payment.
-- =====================================================

CREATE TABLE public.transactions (

    transaction_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    payment_id UUID NOT NULL
        REFERENCES public.payments(payment_id),

    account_id UUID NOT NULL
        REFERENCES public.accounts(account_id),

    entry_type VARCHAR(10) NOT NULL
        CHECK (entry_type IN ('debit', 'credit')),

    amount NUMERIC(18,2) NOT NULL
        CHECK (amount > 0),

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_payment_entry
        UNIQUE (payment_id, entry_type)

);

CREATE INDEX idx_transactions_account_date
    ON public.transactions(account_id, created_at DESC);


-- =====================================================
-- 5. APPLICATION PERMISSIONS
-- banking_app can read necessary records and perform
-- only the write operations required for payment flows.
--
-- Identity and customer data remain admin-managed.
-- =====================================================

GRANT USAGE ON SCHEMA public TO banking_app;

GRANT SELECT ON
    public.customers,
    public.users,
    public.accounts,
    public.payments,
    public.transactions
TO banking_app;

GRANT UPDATE (balance)
    ON public.accounts
TO banking_app;

GRANT INSERT
    ON public.payments,
       public.transactions
TO banking_app;


-- =====================================================
-- 6. MIGRATION HISTORY
-- Record migration 002 only after schema creation
-- and permission configuration succeed.
-- =====================================================

INSERT INTO public.schema_migrations
    (version, description, status)
VALUES
    ('002', 'Banking accounts payments transactions', 'applied');