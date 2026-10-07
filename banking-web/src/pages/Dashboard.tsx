import {
    useCallback,
    useEffect,
    useState,
} from 'react'

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    Grid,
    Stack,
    Typography,
} from '@mui/material'

import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'

import {
    useLocation,
    useNavigate,
} from 'react-router-dom'

import { apiEndpoints } from '../api/endpoints'

import {
    ApiError,
    apiGet,
} from '../api/apiClient'


type Account = {
    account_id: string
    account_type: string
    masked_account_number: string
    balance: string
    currency: string
}


type Transaction = {
    transaction_id: string
    payment_id: string
    entry_type: string
    amount: string
    created_at: string
}


type DashboardTransaction =
    Transaction & {
        account_id: string
        account_type: string
        masked_account_number: string
        currency: string
    }


export default function Dashboard() {
    const navigate = useNavigate()

    const location = useLocation()

    const [accounts, setAccounts] =
        useState<Account[]>([])

    const [
        recentTransactions,
        setRecentTransactions,
    ] =
        useState<
            DashboardTransaction[]
        >([])

    const [isLoading, setIsLoading] =
        useState(true)

    const [
        errorMessage,
        setErrorMessage,
    ] =
        useState('')


    const loadDashboard =
        useCallback(async () => {
            setIsLoading(true)
            setErrorMessage('')

            try {
                /*
                  apiGet automatically:
                  - reads the JWT
                  - adds Authorization header
                  - calls fetch
                  - parses JSON
                  - detects 401
                */
                const accountData =
                    await apiGet<Account[]>(
                        apiEndpoints.accounts.list
                    )

                setAccounts(accountData)


                /*
                  Each account has its own
                  transaction-history endpoint.

                  We load all of them because
                  Dashboard recent activity
                  combines activity across
                  all owned accounts.
                */
                const transactionRequests =
                    accountData.map(
                        async (account) => {
                            try {
                                const transactions =
                                    await apiGet<
                                        Transaction[]
                                    >(
                                        apiEndpoints
                                            .accounts
                                            .transactions(
                                                account.account_id
                                            )
                                    )

                                return transactions.map(
                                    (
                                        transaction
                                    ) => ({
                                        ...transaction,

                                        account_id:
                                            account.account_id,

                                        account_type:
                                            account.account_type,

                                        masked_account_number:
                                            account.masked_account_number,

                                        currency:
                                            account.currency,
                                    })
                                )
                            } catch (error) {
                                /*
                                  Authentication failures
                                  should stop Dashboard.

                                  A failure loading history
                                  for one account should not
                                  prevent balances from showing.
                                */
                                if (
                                    error instanceof
                                    ApiError &&
                                    error.status ===
                                    401
                                ) {
                                    throw error
                                }

                                return []
                            }
                        }
                    )


                const transactionResults =
                    await Promise.all(
                        transactionRequests
                    )


                /*
                  Combine transactions from
                  checking, savings, etc.

                  Sort newest first and show
                  only the five most recent.
                */
                const combinedTransactions =
                    transactionResults
                        .flat()
                        .sort(
                            (a, b) =>
                                new Date(
                                    b.created_at
                                ).getTime() -
                                new Date(
                                    a.created_at
                                ).getTime()
                        )
                        .slice(0, 5)


                setRecentTransactions(
                    combinedTransactions
                )
            } catch (error) {
                console.error(
                    'Dashboard request failed.'
                )

                if (
                    error instanceof
                    ApiError
                ) {
                    setErrorMessage(
                        error.message
                    )
                } else {
                    setErrorMessage(
                        'Unable to load dashboard.'
                    )
                }
            } finally {
                setIsLoading(false)
            }
        }, [])


    /*
      Important refresh behavior:

      React Router gives each navigation
      entry a location key.

      When the user goes:

      Dashboard
          ↓
      Transfer
          ↓
      Dashboard

      the location key changes.

      That causes Dashboard to request fresh
      account balances and transaction data.

      No browser refresh is required.
    */
    useEffect(() => {
        loadDashboard()
    }, [
        location.key,
        loadDashboard,
    ])


    function formatAccountType(
        accountType: string
    ) {
        return (
            accountType
                .charAt(0)
                .toUpperCase() +
            accountType.slice(1)
        )
    }


    function formatMoney(
        value: string | number,
        currency: string
    ) {
        return new Intl.NumberFormat(
            'en-US',
            {
                style: 'currency',
                currency,
            }
        ).format(
            Number(value)
        )
    }


    function formatTransactionAmount(
        transaction:
            DashboardTransaction
    ) {
        const sign =
            transaction.entry_type
                .toLowerCase() ===
                'debit'
                ? '-'
                : '+'

        return `${sign}${formatMoney(
            transaction.amount,
            transaction.currency
        )}`
    }


    function formatDate(
        createdAt: string
    ) {
        return new Date(
            createdAt
        ).toLocaleString(
            'en-US',
            {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
            }
        )
    }


    /*
      Current lab accounts use USD.

      If multiple currencies are added later,
      we should group totals by currency
      instead of adding them together.
    */
    const totalBalance =
        accounts.reduce(
            (
                total,
                account
            ) =>
                total +
                Number(
                    account.balance
                ),
            0
        )


    const dashboardCurrency =
        accounts[0]?.currency ??
        'USD'


    return (
        <Stack
            spacing={{
                xs: 3,
                md: 4,
            }}
        >
            <Box>
                <Typography
                    variant="h4"
                    sx={{
                        fontWeight: 700,

                        fontSize: {
                            xs: '1.75rem',
                            sm: '2rem',
                            md: '2.125rem',
                        },
                    }}
                >
                    Good morning
                </Typography>

                <Typography
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    Your wallet looks happy today.
                </Typography>
            </Box>


            {errorMessage && (
                <Alert severity="error">
                    {errorMessage}
                </Alert>
            )}


            {isLoading ? (
                <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                >
                    <CircularProgress
                        size={24}
                    />

                    <Typography
                        color="text.secondary"
                    >
                        Loading dashboard...
                    </Typography>
                </Stack>
            ) : (
                <>
                    <Card>
                        <CardContent
                            sx={{
                                p: {
                                    xs: 2.5,
                                    sm: 3,
                                    md: 4,
                                },
                            }}
                        >
                            <Typography
                                color="text.secondary"
                            >
                                Total balance
                            </Typography>

                            <Typography
                                sx={{
                                    fontWeight: 700,

                                    mt: 1,

                                    fontSize: {
                                        xs: '2rem',
                                        sm: '2.5rem',
                                        md: '3rem',
                                    },
                                }}
                            >
                                {formatMoney(
                                    totalBalance,
                                    dashboardCurrency
                                )}
                            </Typography>

                            <Chip
                                label={`${accounts.length} accounts`}
                                size="small"
                                sx={{
                                    mt: 2,
                                }}
                            />
                        </CardContent>
                    </Card>


                    <Box>
                        <Typography
                            variant="h5"
                            sx={{
                                fontWeight: 700,
                                mb: 2,

                                fontSize: {
                                    xs: '1.3rem',
                                    md: '1.5rem',
                                },
                            }}
                        >
                            Your accounts
                        </Typography>


                        <Grid
                            container
                            spacing={2}
                        >
                            {accounts.map(
                                (account) => (
                                    <Grid
                                        key={
                                            account.account_id
                                        }
                                        size={{
                                            xs: 12,
                                            md: 6,
                                        }}
                                    >
                                        <Card
                                            sx={{
                                                height:
                                                    '100%',
                                            }}
                                        >
                                            <CardContent
                                                sx={{
                                                    p: {
                                                        xs: 2.5,
                                                        md: 3,
                                                    },
                                                }}
                                            >
                                                <Typography
                                                    color="text.secondary"
                                                >
                                                    {formatAccountType(
                                                        account.account_type
                                                    )}
                                                </Typography>

                                                <Typography
                                                    variant="h5"
                                                    sx={{
                                                        fontWeight: 700,
                                                        mt: 1,
                                                    }}
                                                >
                                                    {formatMoney(
                                                        account.balance,
                                                        account.currency
                                                    )}
                                                </Typography>

                                                <Typography
                                                    variant="body2"
                                                    color="text.secondary"
                                                    sx={{
                                                        mt: 1,
                                                    }}
                                                >
                                                    Account{' '}
                                                    {
                                                        account.masked_account_number
                                                    }
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                )
                            )}
                        </Grid>
                    </Box>


                    <Box>
                        <Typography
                            variant="h5"
                            sx={{
                                fontWeight: 700,
                                mb: 2,

                                fontSize: {
                                    xs: '1.3rem',
                                    md: '1.5rem',
                                },
                            }}
                        >
                            Quick actions
                        </Typography>


                        <Stack
                            direction={{
                                xs: 'column',
                                sm: 'row',
                            }}
                            spacing={2}
                        >
                            <Button
                                variant="contained"
                                startIcon={
                                    <SwapHorizIcon />
                                }
                                onClick={() =>
                                    navigate(
                                        '/transfer'
                                    )
                                }
                                fullWidth
                                sx={{
                                    maxWidth: {
                                        sm: 220,
                                    },
                                }}
                            >
                                Transfer Money
                            </Button>

                            <Button
                                variant="outlined"
                                startIcon={
                                    <ReceiptLongIcon />
                                }
                                onClick={() =>
                                    navigate(
                                        '/transactions'
                                    )
                                }
                                fullWidth
                                sx={{
                                    maxWidth: {
                                        sm: 220,
                                    },
                                }}
                            >
                                View Transactions
                            </Button>
                        </Stack>
                    </Box>


                    <Card>
                        <CardContent
                            sx={{
                                p: {
                                    xs: 2.5,
                                    md: 3,
                                },
                            }}
                        >
                            <Typography
                                variant="h5"
                                sx={{
                                    fontWeight: 700,

                                    fontSize: {
                                        xs: '1.3rem',
                                        md: '1.5rem',
                                    },
                                }}
                            >
                                Recent activity
                            </Typography>

                            <Divider
                                sx={{
                                    my: 2,
                                }}
                            />


                            {recentTransactions.length ===
                                0 ? (
                                <Typography
                                    color="text.secondary"
                                >
                                    No recent activity.
                                </Typography>
                            ) : (
                                <Stack
                                    spacing={2}
                                >
                                    {recentTransactions.map(
                                        (
                                            transaction,
                                            index
                                        ) => (
                                            <Box
                                                key={
                                                    transaction.transaction_id
                                                }
                                            >
                                                <Stack
                                                    direction={{
                                                        xs: 'column',
                                                        sm: 'row',
                                                    }}
                                                    justifyContent="space-between"
                                                    alignItems={{
                                                        xs: 'flex-start',
                                                        sm: 'center',
                                                    }}
                                                    spacing={2}
                                                >
                                                    <Stack
                                                        spacing={
                                                            0.75
                                                        }
                                                    >
                                                        <Stack
                                                            direction="row"
                                                            spacing={
                                                                1
                                                            }
                                                            alignItems="center"
                                                        >
                                                            <Chip
                                                                label={
                                                                    transaction.entry_type.toLowerCase() ===
                                                                        'debit'
                                                                        ? 'Debit'
                                                                        : 'Credit'
                                                                }
                                                                size="small"
                                                                variant="outlined"
                                                            />

                                                            <Typography
                                                                sx={{
                                                                    fontWeight: 600,
                                                                }}
                                                            >
                                                                {formatAccountType(
                                                                    transaction.account_type
                                                                )}{' '}
                                                                {
                                                                    transaction.masked_account_number
                                                                }
                                                            </Typography>
                                                        </Stack>


                                                        <Typography
                                                            variant="body2"
                                                            color="text.secondary"
                                                        >
                                                            {formatDate(
                                                                transaction.created_at
                                                            )}
                                                        </Typography>


                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{
                                                                fontFamily:
                                                                    'monospace',

                                                                wordBreak:
                                                                    'break-all',
                                                            }}
                                                        >
                                                            Payment
                                                            ID:{' '}
                                                            {
                                                                transaction.payment_id
                                                            }
                                                        </Typography>
                                                    </Stack>


                                                    <Typography
                                                        sx={{
                                                            fontWeight: 700,

                                                            whiteSpace:
                                                                'nowrap',

                                                            fontSize: {
                                                                xs: '1rem',
                                                                sm: '1.05rem',
                                                            },
                                                        }}
                                                    >
                                                        {formatTransactionAmount(
                                                            transaction
                                                        )}
                                                    </Typography>
                                                </Stack>


                                                {index <
                                                    recentTransactions.length -
                                                    1 && (
                                                        <Divider
                                                            sx={{
                                                                mt: 2,
                                                            }}
                                                        />
                                                    )}
                                            </Box>
                                        )
                                    )}
                                </Stack>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </Stack>
    )
}