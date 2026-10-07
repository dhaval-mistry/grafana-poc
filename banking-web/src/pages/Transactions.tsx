import { useEffect, useState } from 'react'

import {
    Alert,
    Box,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material'

import { useSearchParams } from 'react-router-dom'

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


export default function Transactions() {
    const [
        searchParams,
        setSearchParams,
    ] = useSearchParams()


    const accountIdFromUrl =
        searchParams.get(
            'accountId'
        ) ?? ''


    const [accounts, setAccounts] =
        useState<Account[]>([])


    const [
        selectedAccountId,
        setSelectedAccountId,
    ] =
        useState(
            accountIdFromUrl
        )


    const [
        transactions,
        setTransactions,
    ] =
        useState<Transaction[]>([])


    const [
        isLoadingAccounts,
        setIsLoadingAccounts,
    ] =
        useState(true)


    const [
        isLoadingTransactions,
        setIsLoadingTransactions,
    ] =
        useState(false)


    const [
        errorMessage,
        setErrorMessage,
    ] =
        useState('')


    const selectedAccount =
        accounts.find(
            (account) =>
                account.account_id ===
                selectedAccountId
        )


    useEffect(() => {
        async function loadAccounts() {
            setIsLoadingAccounts(true)
            setErrorMessage('')

            try {
                /*
                  apiGet handles:
                  - JWT retrieval
                  - Authorization header
                  - fetch()
                  - network failures
                  - HTTP 401
                  - JSON parsing
                */
                const data =
                    await apiGet<
                        Account[]
                    >(
                        apiEndpoints
                            .accounts
                            .list
                    )


                setAccounts(data)


                /*
                  If user opened Transactions
                  without choosing an account,
                  automatically select the
                  first available account.

                  We also keep the URL updated:

                  /transactions?accountId=...
                */
                if (
                    selectedAccountId ===
                    '' &&
                    data.length > 0
                ) {
                    setSelectedAccountId(
                        data[0]
                            .account_id
                    )

                    setSearchParams({
                        accountId:
                            data[0]
                                .account_id,
                    })
                }
            } catch (error) {
                console.error(
                    'Account request failed.'
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
                        'Unable to load accounts.'
                    )
                }
            } finally {
                setIsLoadingAccounts(
                    false
                )
            }
        }


        loadAccounts()
    }, [])


    useEffect(() => {
        if (!selectedAccountId) {
            return
        }


        async function loadTransactions() {
            setIsLoadingTransactions(
                true
            )

            setErrorMessage('')

            /*
              Clear previous account's
              transactions immediately so
              stale rows are not displayed
              while the next account loads.
            */
            setTransactions([])

            try {
                const data =
                    await apiGet<
                        Transaction[]
                    >(
                        apiEndpoints
                            .accounts
                            .transactions(
                                selectedAccountId
                            )
                    )


                setTransactions(data)
            } catch (error) {
                console.error(
                    'Transaction request failed.'
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
                        'Unable to load transactions.'
                    )
                }
            } finally {
                setIsLoadingTransactions(
                    false
                )
            }
        }


        loadTransactions()
    }, [selectedAccountId])


    function handleAccountChange(
        accountId: string
    ) {
        setSelectedAccountId(
            accountId
        )

        /*
          Keep the selected account
          in the browser URL.

          This allows Accounts page
          to link directly to a
          specific account history.
        */
        setSearchParams({
            accountId,
        })
    }


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


    function formatAmount(
        amount: string,
        entryType: string,
        currency: string
    ) {
        const numericAmount =
            Number(amount)


        const sign =
            entryType
                .toLowerCase() ===
                'debit'
                ? '-'
                : '+'


        const formattedAmount =
            new Intl.NumberFormat(
                'en-US',
                {
                    style:
                        'currency',

                    currency,
                }
            ).format(
                numericAmount
            )


        return `${sign}${formattedAmount}`
    }


    function formatBalance(
        balance: string,
        currency: string
    ) {
        return new Intl.NumberFormat(
            'en-US',
            {
                style: 'currency',
                currency,
            }
        ).format(
            Number(balance)
        )
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
                        fontWeight:
                            700,

                        fontSize: {
                            xs:
                                '1.75rem',

                            sm:
                                '2rem',

                            md:
                                '2.125rem',
                        },
                    }}
                >
                    Transactions
                </Typography>


                <Typography
                    color="text.secondary"
                    sx={{
                        mt: 0.5,
                    }}
                >
                    Review activity across your accounts.
                </Typography>
            </Box>


            {errorMessage && (
                <Alert
                    severity="error"
                >
                    {errorMessage}
                </Alert>
            )}


            <Card>
                <CardContent
                    sx={{
                        p: {
                            xs: 2,
                            sm: 3,
                        },
                    }}
                >
                    <Stack
                        spacing={3}
                    >
                        {isLoadingAccounts ? (
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
                                    Loading accounts...
                                </Typography>
                            </Stack>
                        ) : (
                            <FormControl
                                fullWidth
                                sx={{
                                    maxWidth: {
                                        xs:
                                            '100%',

                                        sm:
                                            340,
                                    },
                                }}
                            >
                                <InputLabel
                                    id="account-filter-label"
                                >
                                    Account
                                </InputLabel>

                                <Select
                                    labelId="account-filter-label"
                                    value={
                                        selectedAccountId
                                    }
                                    label="Account"
                                    onChange={(
                                        event
                                    ) =>
                                        handleAccountChange(
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                >
                                    {accounts.map(
                                        (
                                            account
                                        ) => (
                                            <MenuItem
                                                key={
                                                    account.account_id
                                                }
                                                value={
                                                    account.account_id
                                                }
                                            >
                                                {formatAccountType(
                                                    account.account_type
                                                )}{' '}
                                                {
                                                    account.masked_account_number
                                                }
                                            </MenuItem>
                                        )
                                    )}
                                </Select>
                            </FormControl>
                        )}


                        {selectedAccount && (
                            <Box>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                >
                                    Viewing transactions for
                                </Typography>


                                <Stack
                                    direction={{
                                        xs:
                                            'column',

                                        sm:
                                            'row',
                                    }}
                                    spacing={{
                                        xs:
                                            0.5,

                                        sm:
                                            2,
                                    }}
                                    alignItems={{
                                        xs:
                                            'flex-start',

                                        sm:
                                            'center',
                                    }}
                                    sx={{
                                        mt: 0.5,
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontWeight:
                                                700,
                                        }}
                                    >
                                        {formatAccountType(
                                            selectedAccount.account_type
                                        )}{' '}
                                        {
                                            selectedAccount.masked_account_number
                                        }
                                    </Typography>


                                    <Typography
                                        color="text.secondary"
                                    >
                                        Balance:{' '}
                                        {formatBalance(
                                            selectedAccount.balance,
                                            selectedAccount.currency
                                        )}
                                    </Typography>
                                </Stack>
                            </Box>
                        )}


                        {isLoadingTransactions && (
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
                                    Loading transactions...
                                </Typography>
                            </Stack>
                        )}


                        {!isLoadingTransactions &&
                            transactions.length ===
                            0 &&
                            selectedAccountId && (
                                <Alert
                                    severity="info"
                                >
                                    No transactions were found for this account.
                                </Alert>
                            )}


                        {!isLoadingTransactions &&
                            transactions.length >
                            0 && (
                                <TableContainer
                                    sx={{
                                        overflowX:
                                            'auto',
                                    }}
                                >
                                    <Table
                                        sx={{
                                            minWidth:
                                                700,
                                        }}
                                    >
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>
                                                    Date
                                                </TableCell>

                                                <TableCell>
                                                    Type
                                                </TableCell>

                                                <TableCell>
                                                    Payment ID
                                                </TableCell>

                                                <TableCell
                                                    align="right"
                                                >
                                                    Amount
                                                </TableCell>
                                            </TableRow>
                                        </TableHead>


                                        <TableBody>
                                            {transactions.map(
                                                (
                                                    transaction
                                                ) => (
                                                    <TableRow
                                                        key={
                                                            transaction.transaction_id
                                                        }
                                                        hover
                                                    >
                                                        <TableCell
                                                            sx={{
                                                                whiteSpace:
                                                                    'nowrap',
                                                            }}
                                                        >
                                                            {formatDate(
                                                                transaction.created_at
                                                            )}
                                                        </TableCell>


                                                        <TableCell>
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
                                                        </TableCell>


                                                        <TableCell>
                                                            <Typography
                                                                variant="body2"
                                                                sx={{
                                                                    fontFamily:
                                                                        'monospace',
                                                                }}
                                                            >
                                                                {
                                                                    transaction.payment_id
                                                                }
                                                            </Typography>
                                                        </TableCell>


                                                        <TableCell
                                                            align="right"
                                                            sx={{
                                                                fontWeight:
                                                                    700,

                                                                whiteSpace:
                                                                    'nowrap',
                                                            }}
                                                        >
                                                            {formatAmount(
                                                                transaction.amount,
                                                                transaction.entry_type,
                                                                selectedAccount
                                                                    ?.currency ??
                                                                'USD'
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                    </Stack>
                </CardContent>
            </Card>
        </Stack>
    )
}