-- Migration tracking for the Synthetic Banking Lab.
-- Records which database migrations have been applied or baselined.
-- Execute using banking_admin.

CREATE TABLE public.schema_migrations (

    version VARCHAR(20) PRIMARY KEY,

    description TEXT NOT NULL,

    status VARCHAR(20) NOT NULL
        CHECK (status IN ('applied', 'baselined')),

    recorded_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP

);