import { config } from '../config'

export const apiEndpoints = {
    auth: {
        login: `${config.apiBaseUrl}/api/v1/auth/token`,
    },

    customers: {
        me: `${config.apiBaseUrl}/api/v1/customers/me`,
    },

    accounts: {
        list: `${config.apiBaseUrl}/api/v1/accounts`,

        lookupRecipient:
            `${config.apiBaseUrl}/api/v1/accounts/lookup`,


        transactions: (accountId: string) =>
            `${config.apiBaseUrl}/api/v1/accounts/${accountId}/transactions`,
    },
    payments: {
        create: `${config.apiBaseUrl}/api/v1/payments`,

        getById: (paymentId: string) =>
            `${config.apiBaseUrl}/api/v1/payments/${paymentId}`,
    },
}