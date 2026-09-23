-- ==================================================
-- SYNTHETIC BANKING LAB
-- Master Data: Customers, Accounts, Opening Balances
--
-- Execute using banking_admin.
-- All customer details are fictional.
-- This script must not reset existing balances.
-- ==================================================


-- 1. SAFETY VALIDATION
-- Stop if required migrations are missing or
-- business records already exist.

DO $$
BEGIN

    IF (
        SELECT COUNT(*)
        FROM public.schema_migrations
        WHERE version IN ('001', '002')
          AND status IN ('applied', 'baselined')
    ) <> 2 THEN

        RAISE EXCEPTION
            'Required migrations 001 and 002 are missing';

    END IF;

    IF EXISTS (SELECT 1 FROM public.customers)
       OR EXISTS (SELECT 1 FROM public.users)
       OR EXISTS (SELECT 1 FROM public.accounts)
       OR EXISTS (SELECT 1 FROM public.payments)
       OR EXISTS (SELECT 1 FROM public.transactions)
    THEN

        RAISE EXCEPTION
            'Seed aborted: banking data already exists';

    END IF;

END $$;


-- ==================================================
-- 2. CUSTOMERS
-- Fixed UUIDs make the dataset reproducible.
-- Emails, phones and addresses are synthetic.
-- ==================================================

INSERT INTO public.customers
(
    customer_id,
    full_name,
    email,
    phone,
    date_of_birth,
    address
)
VALUES

(
    '10000000-0000-4000-8000-000000000001',
    'Alex Morgan',
    'alex.morgan@example.com',
    '202-555-0101',
    '1990-04-12',
    '100 Example Lane, Testville, CA'
),

(
    '10000000-0000-4000-8000-000000000002',
    'Jordan Lee',
    'jordan.lee@example.com',
    '202-555-0102',
    '1988-07-23',
    '200 Example Lane, Testville, CA'
),

(
    '10000000-0000-4000-8000-000000000003',
    'Taylor Brooks',
    'taylor.brooks@example.com',
    '202-555-0103',
    '1995-11-05',
    '300 Example Lane, Testville, CA'
);


-- ==================================================
-- 3. ACCOUNTS
-- Two accounts per customer.
-- All amounts are USD.
-- Fixed UUIDs and account numbers support testing.
-- ==================================================

INSERT INTO public.accounts
(
    account_id,
    customer_id,
    account_number,
    account_type,
    balance,
    currency,
    is_active
)
VALUES

-- Alex Morgan: Checking
(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'LAB-000001',
    'checking',
    10000.00,
    'USD',
    TRUE
),

-- Alex Morgan: Savings
(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'LAB-000002',
    'savings',
    25000.00,
    'USD',
    TRUE
),

-- Jordan Lee: Checking
(
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'LAB-000003',
    'checking',
    5000.00,
    'USD',
    TRUE
),

-- Jordan Lee: Savings
(
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    'LAB-000004',
    'savings',
    15000.00,
    'USD',
    TRUE
),

-- Taylor Brooks: Checking
(
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000003',
    'LAB-000005',
    'checking',
    250.00,
    'USD',
    TRUE
),

-- Taylor Brooks: Savings
(
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000003',
    'LAB-000006',
    'savings',
    2000.00,
    'USD',
    TRUE
);