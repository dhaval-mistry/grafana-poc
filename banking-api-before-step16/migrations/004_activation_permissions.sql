-- Migration 004: Activation API permissions
-- Run using banking_admin.
-- No customer data or passwords are modified.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '003'
          AND status = 'applied'
    ) THEN
        RAISE EXCEPTION 'Migration 003 is not applied';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = '004'
    ) THEN
        RAISE EXCEPTION 'Migration 004 already recorded';
    END IF;
END $$;


-- Allow FastAPI to validate activation information.
GRANT SELECT (
    activation_id,
    customer_id,
    username,
    token_hash,
    expires_at,
    used_at
)
ON public.account_activations
TO banking_app;


-- Allow FastAPI to create an activated user.
-- The database generates user_id and created_at.
GRANT INSERT (
    customer_id,
    username,
    password_hash
)
ON public.users
TO banking_app;


-- Allow FastAPI to mark an activation token as consumed.
GRANT UPDATE (used_at)
ON public.account_activations
TO banking_app;


-- Record the migration.
INSERT INTO public.schema_migrations
    (version, description, status)
VALUES
    ('004', 'Activation API permissions', 'applied');