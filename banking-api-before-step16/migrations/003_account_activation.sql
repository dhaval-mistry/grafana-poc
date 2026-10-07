-- =====================================================
-- Migration 003: First-Time Account Activation
--
-- Purpose:
-- Store secure, one-time activation information.
--
-- Execute using banking_admin.
-- Do not store plaintext activation tokens.
-- =====================================================

-- Safety check: migration 002 must already exist.
-- Prevent accidental execution against an unexpected schema.

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '002'
          AND status = 'applied'
    ) THEN
        RAISE EXCEPTION 'Migration 002 is not applied';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '003'
    ) THEN
        RAISE EXCEPTION 'Migration 003 already recorded';
    END IF;

    IF to_regclass('public.account_activations') IS NOT NULL
    THEN
        RAISE EXCEPTION 'Activation table already exists';
    END IF;

END $$;


-- One activation record per customer.
-- Username is reserved before the user account exists.

CREATE TABLE public.account_activations (

    activation_id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    customer_id UUID NOT NULL UNIQUE
        REFERENCES public.customers(customer_id),

    username VARCHAR(100) NOT NULL UNIQUE,

    -- Hexadecimal SHA-256 digest of a random activation token.
    -- Passwords use a separate, slower password-hashing algorithm.
    token_hash VARCHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    expires_at TIMESTAMPTZ NOT NULL,

    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_activation_expiry
        CHECK (expires_at > created_at),

    CONSTRAINT chk_activation_usage
        CHECK (used_at IS NULL OR used_at >= created_at)

);


-- Record migration 003 after successful table creation.

INSERT INTO public.schema_migrations
    (version, description, status)
VALUES
    ('003', 'First-time account activation', 'applied');