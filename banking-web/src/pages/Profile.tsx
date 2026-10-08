import { useEffect, useState } from 'react'

import {
    Alert,
    Avatar,
    Box,
    Card,
    CardContent,
    CircularProgress,
    Divider,
    Grid,
    Stack,
    Typography,
} from '@mui/material'

import PersonIcon from '@mui/icons-material/Person'
import EmailIcon from '@mui/icons-material/Email'
import PhoneIcon from '@mui/icons-material/Phone'
import HomeIcon from '@mui/icons-material/Home'
import CakeIcon from '@mui/icons-material/Cake'
import BadgeIcon from '@mui/icons-material/Badge'

import { apiEndpoints } from '../api/endpoints'

import {
    ApiError,
    apiGet,
} from '../api/apiClient'


type CustomerProfile = {
    customer_id: string
    full_name: string
    email: string
    phone: string
    date_of_birth: string
    address: string
}


export default function Profile() {
    const [
        profile,
        setProfile,
    ] =
        useState<CustomerProfile | null>(
            null
        )

    const [isLoading, setIsLoading] =
        useState(true)

    const [
        errorMessage,
        setErrorMessage,
    ] =
        useState('')


    useEffect(() => {
        async function loadProfile() {
            setIsLoading(true)
            setErrorMessage('')

            try {
                const data =
                    await apiGet<
                        CustomerProfile
                    >(
                        apiEndpoints
                            .customers.me
                    )

                setProfile(data)
            } catch (error) {
                console.error(
                    'Profile request failed.'
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
                        'Unable to load profile.'
                    )
                }
            } finally {
                setIsLoading(false)
            }
        }


        loadProfile()
    }, [])


    function formatDate(
        value: string
    ) {
        const date =
            new Date(
                `${value}T00:00:00`
            )

        return date.toLocaleDateString(
            'en-US',
            {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
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
                        fontWeight: 700,

                        fontSize: {
                            xs: '1.75rem',
                            sm: '2rem',
                            md: '2.125rem',
                        },
                    }}
                >
                    Profile
                </Typography>

                <Typography
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    Your account details, minus the paperwork mountain.
                </Typography>
            </Box>


            {isLoading && (
                <Stack
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: 'center' }}
                >
                    <CircularProgress
                        size={24}
                    />

                    <Typography
                        color="text.secondary"
                    >
                        Loading profile...
                    </Typography>
                </Stack>
            )}


            {errorMessage && (
                <Alert severity="error">
                    {errorMessage}
                </Alert>
            )}


            {!isLoading &&
                !errorMessage &&
                profile && (
                    <>
                        <Card>
                            <CardContent
                                sx={{
                                    p: {
                                        xs: 2.5,
                                        sm: 3,
                                    },
                                }}
                            >
                                <Stack
                                    direction={{
                                        xs:
                                            'column',

                                        sm:
                                            'row',
                                    }}
                                    spacing={3}
                                    sx={{ alignItems: {
                                        xs:
                                            'flex-start',

                                        sm:
                                            'center',
                                    } }}
                                >
                                    <Avatar
                                        sx={{
                                            width: {
                                                xs:
                                                    64,

                                                sm:
                                                    72,
                                            },

                                            height:
                                            {
                                                xs:
                                                    64,

                                                sm:
                                                    72,
                                            },
                                        }}
                                    >
                                        <PersonIcon
                                            fontSize="large"
                                        />
                                    </Avatar>

                                    <Box>
                                        <Typography
                                            variant="h5"
                                            sx={{
                                                fontWeight:
                                                    700,

                                                fontSize:
                                                {
                                                    xs:
                                                        '1.4rem',

                                                    sm:
                                                        '1.5rem',
                                                },
                                            }}
                                        >
                                            {
                                                profile.full_name
                                            }
                                        </Typography>

                                        <Typography
                                            color="text.secondary"
                                        >
                                            Happy Wallet Bank Customer
                                        </Typography>
                                    </Box>
                                </Stack>
                            </CardContent>
                        </Card>


                        <Grid
                            container
                            spacing={3}
                        >
                            <Grid
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
                                                xs:
                                                    2.5,

                                                sm:
                                                    3,
                                            },
                                        }}
                                    >
                                        <Typography
                                            variant="h6"
                                            sx={{
                                                fontWeight:
                                                    700,

                                                mb: 2,
                                            }}
                                        >
                                            Contact Information
                                        </Typography>


                                        <Stack
                                            spacing={2}
                                        >
                                            <Stack
                                                direction="row"
                                                spacing={
                                                    2
                                                }
                                            >
                                                <EmailIcon
                                                    color="action"
                                                />

                                                <Box
                                                    sx={{
                                                        minWidth:
                                                            0,
                                                    }}
                                                >
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Email
                                                    </Typography>

                                                    <Typography
                                                        sx={{
                                                            wordBreak:
                                                                'break-word',
                                                        }}
                                                    >
                                                        {
                                                            profile.email
                                                        }
                                                    </Typography>
                                                </Box>
                                            </Stack>


                                            <Divider />


                                            <Stack
                                                direction="row"
                                                spacing={
                                                    2
                                                }
                                            >
                                                <PhoneIcon
                                                    color="action"
                                                />

                                                <Box>
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Phone
                                                    </Typography>

                                                    <Typography>
                                                        {
                                                            profile.phone
                                                        }
                                                    </Typography>
                                                </Box>
                                            </Stack>


                                            <Divider />


                                            <Stack
                                                direction="row"
                                                spacing={
                                                    2
                                                }
                                            >
                                                <HomeIcon
                                                    color="action"
                                                />

                                                <Box>
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Address
                                                    </Typography>

                                                    <Typography>
                                                        {
                                                            profile.address
                                                        }
                                                    </Typography>
                                                </Box>
                                            </Stack>
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Grid>


                            <Grid
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
                                                xs:
                                                    2.5,

                                                sm:
                                                    3,
                                            },
                                        }}
                                    >
                                        <Typography
                                            variant="h6"
                                            sx={{
                                                fontWeight:
                                                    700,

                                                mb: 2,
                                            }}
                                        >
                                            Customer Information
                                        </Typography>


                                        <Stack
                                            spacing={2}
                                        >
                                            <Stack
                                                direction="row"
                                                spacing={
                                                    2
                                                }
                                            >
                                                <BadgeIcon
                                                    color="action"
                                                />

                                                <Box
                                                    sx={{
                                                        minWidth:
                                                            0,
                                                    }}
                                                >
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Customer ID
                                                    </Typography>

                                                    <Typography
                                                        sx={{
                                                            wordBreak:
                                                                'break-all',
                                                        }}
                                                    >
                                                        {
                                                            profile.customer_id
                                                        }
                                                    </Typography>
                                                </Box>
                                            </Stack>


                                            <Divider />


                                            <Stack
                                                direction="row"
                                                spacing={
                                                    2
                                                }
                                            >
                                                <CakeIcon
                                                    color="action"
                                                />

                                                <Box>
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                    >
                                                        Date of Birth
                                                    </Typography>

                                                    <Typography>
                                                        {formatDate(
                                                            profile.date_of_birth
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </Stack>
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>
                    </>
                )}


            {!isLoading &&
                !errorMessage &&
                !profile && (
                    <Alert severity="info">
                        No profile information was found.
                    </Alert>
                )}
        </Stack>
    )
}
