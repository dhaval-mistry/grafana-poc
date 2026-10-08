import { useEffect, useRef, useState } from 'react'
import { cancelJourney, completeJourney, failJourney, failureForStatus, recipientVerificationFailed, setJourneyStage, startJourney } from '../observability/telemetry'
import type { Journey } from '../observability/telemetry'

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    FormLabel,
    InputAdornment,
    InputLabel,
    MenuItem,
    Radio,
    RadioGroup,
    Select,
    Stack,
    TextField,
    Typography,
} from '@mui/material'

import AddIcon from '@mui/icons-material/Add'

import { apiEndpoints } from '../api/endpoints'

import {
    ApiError,
    apiGet,
    apiPostJson,
} from '../api/apiClient'

type TransferType =
    | 'my-accounts'
    | 'someone-else'

type Account = {
    account_id: string
    account_type: string
    masked_account_number: string
    balance: string
    currency: string
}

type RecipientLookupResponse = {
    account_id: string
    account_type: string
    masked_account_number: string
}

type Recipient = {
    account_id: string
    label: string
    account_type: string
    masked_account_number: string
}

type PaymentResponse = {
    payment_id: string
    amount: string
    status: string
    error_code: string | null
    created_at: string
    completed_at: string | null
}

export default function Transfer() {
    const transferJourney = useRef<Journey | undefined>(undefined)

    useEffect(() => {
        const reference = transferJourney
        return () => cancelJourney(reference.current)
    }, [])

    function beginTransferJourney(hasSource: boolean) {
        // Source/type changes identify a new journey. Destination/amount edits
        // keep this context; the existing idempotency reset rules remain intact.
        cancelJourney(transferJourney.current)
        transferJourney.current = hasSource ? startJourney('transfer') : undefined
    }
    const [transferType, setTransferType] =
        useState<TransferType>('my-accounts')

    const [accounts, setAccounts] =
        useState<Account[]>([])

    const [fromAccountId, setFromAccountId] =
        useState('')

    const [toAccountId, setToAccountId] =
        useState('')

    const [amount, setAmount] =
        useState('')

    const [recipients, setRecipients] =
        useState<Recipient[]>([])

    const [recipientAccountId, setRecipientAccountId] =
        useState('')

    const [addRecipientOpen, setAddRecipientOpen] =
        useState(false)

    const [recipientLabel, setRecipientLabel] =
        useState('')

    const [recipientAccountNumber, setRecipientAccountNumber] =
        useState('')

    const [confirmRecipientAccountNumber, setConfirmRecipientAccountNumber] =
        useState('')

    const [isLookingUpRecipient, setIsLookingUpRecipient] =
        useState(false)

    const [recipientLookupError, setRecipientLookupError] =
        useState('')

    const [isLoadingAccounts, setIsLoadingAccounts] =
        useState(true)

    const [isSubmitting, setIsSubmitting] =
        useState(false)

    const [reviewOpen, setReviewOpen] =
        useState(false)

    const [errorMessage, setErrorMessage] =
        useState('')

    const [transferErrorMessage, setTransferErrorMessage] =
        useState('')

    const [successMessage, setSuccessMessage] =
        useState('')

    const [paymentId, setPaymentId] =
        useState('')

    const [idempotencyKey, setIdempotencyKey] =
        useState<string | null>(null)

    const selectedFromAccount = accounts.find(
        (account) =>
            account.account_id === fromAccountId
    )

    const selectedToAccount = accounts.find(
        (account) =>
            account.account_id === toAccountId
    )

    const selectedRecipient = recipients.find(
        (recipient) =>
            recipient.account_id === recipientAccountId
    )

    const numericAmount = Number(amount)

    const destinationAccountId =
        transferType === 'my-accounts'
            ? toAccountId
            : recipientAccountId

    const isSameAccount =
        fromAccountId !== '' &&
        destinationAccountId !== '' &&
        fromAccountId === destinationAccountId

    const isInvalidAmount =
        amount !== '' &&
        (!Number.isFinite(numericAmount) ||
            numericAmount <= 0)

    const hasInsufficientFunds =
        selectedFromAccount !== undefined &&
        Number.isFinite(numericAmount) &&
        numericAmount >
        Number(selectedFromAccount.balance)

    const canReview =
        fromAccountId !== '' &&
        destinationAccountId !== '' &&
        amount !== '' &&
        !isSameAccount &&
        !isInvalidAmount &&
        !hasInsufficientFunds

    const recipientNumbersMatch =
        recipientAccountNumber.trim() !== '' &&
        recipientAccountNumber.trim() ===
        confirmRecipientAccountNumber.trim()

    useEffect(() => {
        loadAccounts()
    }, [])

    async function loadAccounts() {
        setIsLoadingAccounts(true)
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
            setIsLoadingAccounts(
                false
            )
        }
    }

    function resetPaymentAttempt() {
        setSuccessMessage('')
        setPaymentId('')
        setIdempotencyKey(null)
        setTransferErrorMessage('')
    }

    function handleTransferTypeChange(
        value: TransferType
    ) {
        beginTransferJourney(fromAccountId !== '')
        setTransferType(value)

        setToAccountId('')
        setRecipientAccountId('')
        setAmount('')

        resetPaymentAttempt()
    }

    async function handleAddRecipient() {
        if (
            recipientLabel.trim() ===
            '' ||
            !recipientNumbersMatch
        ) {
            return
        }

        const journey = transferJourney.current
        setJourneyStage(journey, 'recipient_verify')


        setIsLookingUpRecipient(
            true
        )

        setRecipientLookupError(
            ''
        )


        try {
            const data =
                await apiPostJson<
                    RecipientLookupResponse
                >(
                    apiEndpoints
                        .accounts
                        .lookupRecipient,

                    {
                        account_number:
                            recipientAccountNumber.trim(),
                    },
                    {},
                    journey
                )


            const newRecipient:
                Recipient = {
                account_id:
                    data.account_id,

                label:
                    recipientLabel.trim(),

                account_type:
                    data.account_type,

                masked_account_number:
                    data.masked_account_number,
            }


            setRecipients(
                (
                    currentRecipients
                ) => {
                    const withoutExisting =
                        currentRecipients.filter(
                            (
                                recipient
                            ) =>
                                recipient.account_id !==
                                data.account_id
                        )


                    return [
                        ...withoutExisting,
                        newRecipient,
                    ]
                }
            )


            setRecipientAccountId(
                data.account_id
            )

            setAddRecipientOpen(
                false
            )

            setRecipientLabel('')
            setRecipientAccountNumber(
                ''
            )

            setConfirmRecipientAccountNumber(
                ''
            )

            resetPaymentAttempt()
        } catch (error) {
            recipientVerificationFailed(journey, error instanceof ApiError ? failureForStatus(error.status) : 'internal')
            console.error(
                'Recipient lookup failed.'
            )


            if (
                error instanceof
                ApiError
            ) {
                if (
                    error.status ===
                    404
                ) {
                    setRecipientLookupError(
                        'Recipient account was not found.'
                    )
                } else {
                    setRecipientLookupError(
                        error.message
                    )
                }
            } else {
                setRecipientLookupError(
                    'Unable to verify recipient.'
                )
            }
        } finally {
            setIsLookingUpRecipient(
                false
            )
        }
    }

    function handleReview() {
        if (!canReview) {
            return
        }

        setJourneyStage(transferJourney.current, 'review')

        if (!idempotencyKey) {
            setIdempotencyKey(
                crypto.randomUUID()
            )
        }

        setTransferErrorMessage('')
        setErrorMessage('')
        setReviewOpen(true)
    }

    async function handleConfirm() {
        if (
            !selectedFromAccount ||
            !destinationAccountId ||
            !idempotencyKey
        ) {
            return
        }

        const journey = transferJourney.current
        setJourneyStage(journey, 'submit')


        setIsSubmitting(true)

        setTransferErrorMessage(
            ''
        )


        try {
            const data =
                await apiPostJson<
                    PaymentResponse
                >(
                    apiEndpoints
                        .payments
                        .create,

                    {
                        source_account_id:
                            fromAccountId,

                        destination_account_id:
                            destinationAccountId,

                        amount,
                    },

                    {
                        'Idempotency-Key':
                            idempotencyKey,
                    },
                    journey
                )

            // Observe only the safe business outcome, never payment fields.
            if (journey) completeJourney(journey)
            if (transferJourney.current === journey) transferJourney.current = undefined


            const destinationName =
                transferType ===
                    'my-accounts'
                    ? selectedToAccount
                        ? `${formatAccountType(
                            selectedToAccount.account_type
                        )} ${selectedToAccount.masked_account_number}`
                        : 'selected account'
                    : selectedRecipient
                        ? `${selectedRecipient.label} ${selectedRecipient.masked_account_number}`
                        : 'selected recipient'


            setReviewOpen(false)

            setPaymentId(
                data.payment_id
            )


            setSuccessMessage(
                `${formatMoney(
                    data.amount,
                    selectedFromAccount.currency
                )} successfully transferred to ${destinationName}.`
            )


            /*
              Payment definitely succeeded.
    
              The next logical transfer
              must get a new idempotency key.
            */
            setIdempotencyKey(null)

            setFromAccountId('')
            setToAccountId('')
            setRecipientAccountId('')
            setAmount('')


            /*
              Refresh source balances after
              the committed payment.
            */
            await loadAccounts()
        } catch (error) {
            // HTTP 409 has several possible causes; do not infer insufficient
            // funds from it or inspect an error body. Backend spans are definitive.
            if (journey) failJourney(journey, error instanceof ApiError ? failureForStatus(error.status) : 'internal', true)
            console.error(
                'Payment request failed.'
            )


            if (
                error instanceof
                ApiError
            ) {
                if (
                    error.status ===
                    404
                ) {
                    setTransferErrorMessage(
                        'The destination account is no longer available.'
                    )
                } else if (
                    error.status ===
                    409
                ) {
                    setTransferErrorMessage(
                        'The transfer could not be completed. Please verify the balance and transfer details.'
                    )
                } else if (
                    error.status ===
                    422
                ) {
                    setTransferErrorMessage(
                        'The transfer request was not accepted by the banking API.'
                    )
                } else {
                    setTransferErrorMessage(
                        error.message
                    )
                }
            } else {
                setTransferErrorMessage(
                    'Unable to confirm whether the transfer completed. Please retry the same transfer.'
                )
            }


            /*
              IMPORTANT:
    
              Do NOT clear idempotencyKey here.
    
              If the outcome is uncertain,
              retrying the same logical transfer
              must reuse the same key.
            */
        } finally {
            setIsSubmitting(false)
        }
    }

    function formatAccountType(
        accountType: string
    ) {
        return (
            accountType.charAt(0).toUpperCase() +
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
        ).format(Number(value))
    }

    return (
        <Stack spacing={{ xs: 3, md: 4 }}>
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
                    Transfer Money
                </Typography>

                <Typography
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    Transfer money securely between accounts.
                </Typography>
            </Box>

            {successMessage && (
                <Alert severity="success">
                    <Stack spacing={0.5}>
                        <Typography>
                            {successMessage}
                        </Typography>

                        {paymentId && (
                            <Typography variant="body2">
                                Payment ID: {paymentId}
                            </Typography>
                        )}
                    </Stack>
                </Alert>
            )}

            {errorMessage && (
                <Alert severity="error">
                    {errorMessage}
                </Alert>
            )}

            <Card>
                <CardContent
                    sx={{
                        p: {
                            xs: 2,
                            sm: 3,
                            md: 4,
                        },
                    }}
                >
                    {isLoadingAccounts ? (
                        <Stack
                            direction="row"
                            spacing={2}
                            sx={{ alignItems: 'center' }}
                        >
                            <CircularProgress size={24} />

                            <Typography color="text.secondary">
                                Loading accounts...
                            </Typography>
                        </Stack>
                    ) : (
                        <Stack spacing={3}>
                            <FormControl>
                                <FormLabel>
                                    Transfer To
                                </FormLabel>

                                <RadioGroup
                                    row
                                    value={transferType}
                                    onChange={(event) =>
                                        handleTransferTypeChange(
                                            event.target
                                                .value as TransferType
                                        )
                                    }
                                >
                                    <FormControlLabel
                                        value="my-accounts"
                                        control={<Radio />}
                                        label="My Accounts"
                                    />

                                    <FormControlLabel
                                        value="someone-else"
                                        control={<Radio />}
                                        label="Someone Else"
                                    />
                                </RadioGroup>
                            </FormControl>

                            <FormControl fullWidth>
                                <InputLabel>
                                    From Account
                                </InputLabel>

                                <Select
                                    value={fromAccountId}
                                    label="From Account"
                                    onChange={(event) => {
                                        beginTransferJourney(event.target.value !== '')
                                        setFromAccountId(
                                            event.target.value
                                        )

                                        resetPaymentAttempt()
                                    }}
                                >
                                    {accounts.map(
                                        (account) => (
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
                                                {' — '}
                                                {formatMoney(
                                                    account.balance,
                                                    account.currency
                                                )}
                                            </MenuItem>
                                        )
                                    )}
                                </Select>
                            </FormControl>

                            {transferType ===
                                'my-accounts' ? (
                                <FormControl fullWidth>
                                    <InputLabel>
                                        To Account
                                    </InputLabel>

                                    <Select
                                        value={toAccountId}
                                        label="To Account"
                                        onChange={(event) => {
                                            setToAccountId(
                                                event.target.value
                                            )

                                            resetPaymentAttempt()
                                        }}
                                    >
                                        {accounts.map(
                                            (account) => (
                                                <MenuItem
                                                    key={
                                                        account.account_id
                                                    }
                                                    value={
                                                        account.account_id
                                                    }
                                                    disabled={
                                                        account.account_id ===
                                                        fromAccountId
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
                            ) : (
                                <Stack spacing={2}>
                                    <FormControl fullWidth>
                                        <InputLabel>
                                            Recipient
                                        </InputLabel>

                                        <Select
                                            value={
                                                recipientAccountId
                                            }
                                            label="Recipient"
                                            onChange={(event) => {
                                                setRecipientAccountId(
                                                    event.target.value
                                                )

                                                resetPaymentAttempt()
                                            }}
                                        >
                                            {recipients.map(
                                                (recipient) => (
                                                    <MenuItem
                                                        key={
                                                            recipient.account_id
                                                        }
                                                        value={
                                                            recipient.account_id
                                                        }
                                                    >
                                                        {recipient.label}
                                                        {' — '}
                                                        {formatAccountType(
                                                            recipient.account_type
                                                        )}{' '}
                                                        {
                                                            recipient.masked_account_number
                                                        }
                                                    </MenuItem>
                                                )
                                            )}
                                        </Select>
                                    </FormControl>

                                    <Button
                                        startIcon={<AddIcon />}
                                        variant="outlined"
                                        onClick={() => {
                                            setRecipientLookupError(
                                                ''
                                            )

                                            setAddRecipientOpen(
                                                true
                                            )
                                        }}
                                        sx={{
                                            alignSelf:
                                                'flex-start',
                                        }}
                                    >
                                        Add New Recipient
                                    </Button>
                                </Stack>
                            )}

                            <TextField
                                label="Amount"
                                value={amount}
                                onChange={(event) => {
                                    setAmount(
                                        event.target.value
                                    )

                                    resetPaymentAttempt()
                                }}
                                inputMode="decimal"
                                fullWidth
                                slotProps={{
                                    input: {
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                $
                                            </InputAdornment>
                                        ),
                                    },
                                }}
                                error={
                                    isInvalidAmount ||
                                    hasInsufficientFunds
                                }
                                helperText={
                                    isInvalidAmount
                                        ? 'Enter an amount greater than zero.'
                                        : hasInsufficientFunds
                                            ? 'Insufficient funds in the selected account.'
                                            : selectedFromAccount
                                                ? `Available balance: ${formatMoney(
                                                    selectedFromAccount.balance,
                                                    selectedFromAccount.currency
                                                )}`
                                                : 'Select a source account first.'
                                }
                            />

                            <Button
                                variant="contained"
                                size="large"
                                disabled={!canReview}
                                onClick={handleReview}
                                fullWidth
                                sx={{
                                    maxWidth: {
                                        sm: 260,
                                    },
                                }}
                            >
                                Review Transfer
                            </Button>
                        </Stack>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={addRecipientOpen}
                onClose={() => {
                    if (!isLookingUpRecipient) {
                        setAddRecipientOpen(false)
                    }
                }}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle
                    sx={{
                        fontWeight: 700,
                        color: 'text.primary',
                    }}
                >
                    Add New Recipient
                </DialogTitle>

                <DialogContent>
                    <Stack
                        spacing={2}
                        sx={{ mt: 1 }}
                    >
                        {recipientLookupError && (
                            <Alert severity="error">
                                {recipientLookupError}
                            </Alert>
                        )}

                        <TextField
                            label="Recipient Name"
                            value={recipientLabel}
                            onChange={(event) =>
                                setRecipientLabel(
                                    event.target.value
                                )
                            }
                            fullWidth
                            helperText="Used only as a display label in this application."
                        />

                        <TextField
                            label="Account Number"
                            value={recipientAccountNumber}
                            onChange={(event) =>
                                setRecipientAccountNumber(
                                    event.target.value
                                )
                            }
                            fullWidth
                            placeholder="LAB-000003"
                        />

                        <TextField
                            label="Confirm Account Number"
                            value={
                                confirmRecipientAccountNumber
                            }
                            onChange={(event) =>
                                setConfirmRecipientAccountNumber(
                                    event.target.value
                                )
                            }
                            fullWidth
                            error={
                                confirmRecipientAccountNumber !==
                                '' &&
                                !recipientNumbersMatch
                            }
                            helperText={
                                confirmRecipientAccountNumber !==
                                    '' &&
                                    !recipientNumbersMatch
                                    ? 'Account numbers do not match.'
                                    : ''
                            }
                        />
                    </Stack>
                </DialogContent>

                <DialogActions sx={{ p: 3 }}>
                    <Button
                        onClick={() =>
                            setAddRecipientOpen(false)
                        }
                        disabled={
                            isLookingUpRecipient
                        }
                    >
                        Cancel
                    </Button>

                    <Button
                        variant="contained"
                        onClick={
                            handleAddRecipient
                        }
                        disabled={
                            isLookingUpRecipient ||
                            recipientLabel.trim() ===
                            '' ||
                            !recipientNumbersMatch
                        }
                    >
                        {isLookingUpRecipient
                            ? 'Verifying...'
                            : 'Add Recipient'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={reviewOpen}
                onClose={() => {
                    if (!isSubmitting) {
                        setReviewOpen(false)
                    }
                }}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle
                    sx={{
                        fontWeight: 700,
                        color: 'text.primary',
                    }}
                >
                    Review Transfer
                </DialogTitle>

                <DialogContent>
                    <Stack
                        spacing={2}
                        sx={{ mt: 1 }}
                    >
                        {transferErrorMessage && (
                            <Alert severity="error">
                                {transferErrorMessage}
                            </Alert>
                        )}

                        <Box>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                            >
                                From
                            </Typography>

                            <Typography
                                sx={{ fontWeight: 600 }}
                            >
                                {selectedFromAccount &&
                                    `${formatAccountType(
                                        selectedFromAccount.account_type
                                    )} ${selectedFromAccount.masked_account_number
                                    }`}
                            </Typography>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                            >
                                To
                            </Typography>

                            <Typography
                                sx={{ fontWeight: 600 }}
                            >
                                {transferType ===
                                    'my-accounts'
                                    ? selectedToAccount &&
                                    `${formatAccountType(
                                        selectedToAccount.account_type
                                    )} ${selectedToAccount.masked_account_number
                                    }`
                                    : selectedRecipient &&
                                    `${selectedRecipient.label} — ${formatAccountType(
                                        selectedRecipient.account_type
                                    )} ${selectedRecipient.masked_account_number
                                    }`}
                            </Typography>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                            >
                                Amount
                            </Typography>

                            <Typography
                                variant="h5"
                                sx={{
                                    fontWeight: 700,
                                }}
                            >
                                {selectedFromAccount &&
                                    formatMoney(
                                        numericAmount,
                                        selectedFromAccount.currency
                                    )}
                            </Typography>
                        </Box>
                    </Stack>
                </DialogContent>

                <DialogActions sx={{ p: 3 }}>
                    <Button
                        onClick={() =>
                            setReviewOpen(false)
                        }
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>

                    <Button
                        variant="contained"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? 'Processing...'
                            : 'Confirm Transfer'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    )
}
