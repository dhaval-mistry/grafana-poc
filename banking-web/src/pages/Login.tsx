import { useState } from 'react'

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    CircularProgress,
    Stack,
    TextField,
    Typography,
} from '@mui/material'

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import LoginIcon from '@mui/icons-material/Login'

import { apiEndpoints } from '../api/endpoints'
import { completeJourney, failJourney, failureForStatus, startJourney } from '../observability/telemetry'

import {
    ApiError,
    apiPostForm,
} from '../api/apiClient'


type LoginProps = {
    onLogin:
    (token: string) => void
}


type LoginResponse = {
    access_token: string
    token_type?: string
}


export default function Login({
    onLogin,
}: LoginProps) {
    const [username, setUsername] =
        useState('')

    const [password, setPassword] =
        useState('')

    const [
        errorMessage,
        setErrorMessage,
    ] =
        useState('')

    const [isLoading, setIsLoading] =
        useState(false)


    async function handleLogin() {
        // Each sign-in attempt is independent of any later authenticated journey.
        const journey = startJourney('login')
        setErrorMessage('')
        setIsLoading(true)

        try {
            const formData =
                new URLSearchParams()

            formData.append(
                'username',
                username
            )

            formData.append(
                'password',
                password
            )


            const data =
                await apiPostForm<
                    LoginResponse
                >(
                    apiEndpoints
                        .auth.login,

                    formData,
                    journey
                )


            if (
                !data.access_token
            ) {
                failJourney(journey, 'internal')
                setErrorMessage(
                    'Login succeeded, but no access token was returned.'
                )

                return
            }


            onLogin(
                data.access_token
            )
            completeJourney(journey)
        } catch (error) {
            failJourney(journey, error instanceof ApiError ? failureForStatus(error.status) : 'internal')
            console.error(
                'Login request failed.'
            )

            if (
                error instanceof
                ApiError
            ) {
                if (
                    error.status === 401
                ) {
                    setErrorMessage(
                        'Invalid username or password.'
                    )
                } else if (
                    error.status ===
                    429
                ) {
                    setErrorMessage(
                        'Too many login attempts. Please try again later.'
                    )
                } else {
                    setErrorMessage(
                        error.message
                    )
                }
            } else {
                setErrorMessage(
                    'Unable to sign in.'
                )
            }
        } finally {
            setIsLoading(false)
        }
    }


    return (
        <Box
            sx={{
                minHeight: '100vh',

                display: 'flex',

                alignItems:
                    'center',

                justifyContent:
                    'center',

                px: 2,

                backgroundColor:
                    'background.default',
            }}
        >
            <Card
                sx={{
                    width: '100%',
                    maxWidth: 440,
                }}
            >
                <CardContent
                    sx={{
                        p: {
                            xs: 3,
                            sm: 4,
                        },
                    }}
                >
                    <Stack
                        spacing={3}
                    >
                        <Stack
                            direction="row"
                            spacing={1.5}
                            sx={{ alignItems: 'center', justifyContent: 'center' }}
                        >
                            <AccountBalanceWalletIcon
                                color="primary"
                                sx={{
                                    fontSize:
                                        38,
                                }}
                            />

                            <Typography
                                variant="h5"
                                sx={{
                                    fontWeight:
                                        700,
                                }}
                            >
                                Happy Wallet Bank
                            </Typography>
                        </Stack>


                        <Box
                            sx={{ textAlign: 'center' }}
                        >
                            <Typography
                                variant="h4"
                                sx={{
                                    fontWeight:
                                        700,

                                    fontSize:
                                    {
                                        xs:
                                            '1.75rem',

                                        sm:
                                            '2rem',
                                    },
                                }}
                            >
                                Welcome back
                            </Typography>

                            <Typography
                                color="text.secondary"
                                sx={{
                                    mt: 1,
                                }}
                            >
                                Sign in to keep your wallet happy.
                            </Typography>
                        </Box>


                        {errorMessage && (
                            <Alert
                                severity="error"
                            >
                                {
                                    errorMessage
                                }
                            </Alert>
                        )}


                        <TextField
                            label="Username"
                            value={username}
                            onChange={(
                                event
                            ) => {
                                setUsername(
                                    event
                                        .target
                                        .value
                                )

                                setErrorMessage(
                                    ''
                                )
                            }}
                            fullWidth
                            autoComplete="username"
                            disabled={
                                isLoading
                            }
                        />


                        <TextField
                            label="Password"
                            type="password"
                            value={password}
                            onChange={(
                                event
                            ) => {
                                setPassword(
                                    event
                                        .target
                                        .value
                                )

                                setErrorMessage(
                                    ''
                                )
                            }}
                            fullWidth
                            autoComplete="current-password"
                            disabled={
                                isLoading
                            }
                            onKeyDown={(
                                event
                            ) => {
                                if (
                                    event.key ===
                                    'Enter' &&
                                    !isLoading
                                ) {
                                    handleLogin()
                                }
                            }}
                        />


                        <Button
                            variant="contained"
                            size="large"
                            startIcon={
                                isLoading
                                    ? (
                                        <CircularProgress
                                            size={
                                                20
                                            }
                                            color="inherit"
                                        />
                                    )
                                    : (
                                        <LoginIcon />
                                    )
                            }
                            onClick={
                                handleLogin
                            }
                            disabled={
                                username.trim() ===
                                '' ||
                                password ===
                                '' ||
                                isLoading
                            }
                            fullWidth
                        >
                            {isLoading
                                ? 'Signing In...'
                                : 'Sign In'}
                        </Button>
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    )
}
