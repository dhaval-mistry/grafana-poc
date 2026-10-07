import { useEffect, useState } from 'react'

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Grid,
    Stack,
    Typography,
} from '@mui/material'

import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'

import { useNavigate } from 'react-router-dom'

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


export default function Accounts() {
    const navigate = useNavigate()

    const [accounts, setAccounts] =
        useState<Account[]>([])

    const [isLoading, setIsLoading] =
        useState(true)

    const [
        errorMessage,
        setErrorMessage,
    ] =
        useState('')


    useEffect(() => {
        async function loadAccounts() {
            setIsLoading(true)
            setErrorMessage('')

            try {
                const data =
                    await apiGet<
                        Account[]
                    >(
                        apiEndpoints
                            .accounts
                            .list
                    )

                setAccounts(data)
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
                setIsLoading(false)
            }
        }


        loadAccounts()
    }, [])


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
                    Accounts
                </Typography>

                <Typography
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    Your money, organized and behaving itself.
                </Typography>
            </Box>


            {isLoading && (
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
            )}


            {errorMessage && (
                <Alert severity="error">
                    {errorMessage}
                </Alert>
            )}


            {!isLoading &&
                !errorMessage && (
                    <Grid
                        container
                        spacing={3}
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
                                                    sm: 3,
                                                },
                                            }}
                                        >
                                            <Stack
                                                spacing={
                                                    2.5
                                                }
                                            >
                                                <Stack
                                                    direction="row"
                                                    justifyContent="space-between"
                                                    alignItems="center"
                                                    spacing={
                                                        2
                                                    }
                                                >
                                                    <Typography
                                                        variant="h5"
                                                        sx={{
                                                            fontWeight:
                                                                700,

                                                            fontSize:
                                                            {
                                                                xs:
                                                                    '1.25rem',

                                                                md:
                                                                    '1.5rem',
                                                            },
                                                        }}
                                                    >
                                                        {formatAccountType(
                                                            account.account_type
                                                        )}
                                                    </Typography>

                                                    <Chip
                                                        label="Active"
                                                        size="small"
                                                    />
                                                </Stack>


                                                <Typography
                                                    sx={{
                                                        fontWeight:
                                                            700,

                                                        fontSize:
                                                        {
                                                            xs:
                                                                '1.8rem',

                                                            sm:
                                                                '2rem',
                                                        },
                                                    }}
                                                >
                                                    {formatBalance(
                                                        account.balance,
                                                        account.currency
                                                    )}
                                                </Typography>


                                                <Typography
                                                    color="text.secondary"
                                                >
                                                    Account{' '}
                                                    {
                                                        account.masked_account_number
                                                    }
                                                </Typography>


                                                <Stack
                                                    direction={{
                                                        xs:
                                                            'column',

                                                        sm:
                                                            'row',
                                                    }}
                                                    spacing={
                                                        2
                                                    }
                                                >
                                                    <Button
                                                        variant="outlined"
                                                        startIcon={
                                                            <ReceiptLongIcon />
                                                        }
                                                        onClick={() =>
                                                            navigate(
                                                                `/transactions?accountId=${account.account_id}`
                                                            )
                                                        }
                                                        fullWidth
                                                    >
                                                        View Transactions
                                                    </Button>

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
                                                    >
                                                        Transfer Money
                                                    </Button>
                                                </Stack>
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            )
                        )}
                    </Grid>
                )}


            {!isLoading &&
                !errorMessage &&
                accounts.length ===
                0 && (
                    <Alert severity="info">
                        No accounts were found.
                    </Alert>
                )}
        </Stack>
    )
}