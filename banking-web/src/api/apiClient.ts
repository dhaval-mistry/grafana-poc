import { config } from '../config'
import { safeApiRoute, startApiTelemetry } from '../observability/telemetry'
import type { Journey } from '../observability/telemetry'

export class ApiError extends Error {
    status: number

    constructor(
        status: number,
        message: string
    ) {
        super(message)

        this.name = 'ApiError'
        this.status = status
    }
}


type ApiRequestOptions =
    Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>
        authenticated?: boolean
        journey?: Journey
    }


async function apiRequest<T>(
    url: string,
    options: ApiRequestOptions = {}
): Promise<T> {
    const { journey, ...bankingOptions } = options
    const route = safeApiRoute(url, config.apiBaseUrl)
    const observation = route
        ? startApiTelemetry(route, options.method ?? 'GET', journey)
        : undefined
    try {
        const data = await performApiRequest<T>(url, {
            ...bankingOptions,
            headers: { ...options.headers, ...observation?.headers },
        })
        // Successful responses are all 2xx; only status class is observed.
        observation?.finish(200, false)
        return data
    } catch (error) {
        observation?.finish(error instanceof ApiError ? error.status : 0, true)
        throw error
    }
}

// Keep authentication, bodies, response parsing and existing error messages in
// the original request implementation. Telemetry never sees any payload/token.
async function performApiRequest<T>(
    url: string,
    options: ApiRequestOptions = {}
): Promise<T> {
    const {
        authenticated = true,
        headers = {},
        ...requestOptions
    } = options


    const token =
        authenticated
            ? sessionStorage.getItem(
                'happy-wallet-token'
            )
            : null


    if (
        authenticated &&
        !token
    ) {
        throw new ApiError(
            401,
            'Your login session is not available.'
        )
    }


    const requestHeaders:
        Record<string, string> = {
        ...headers,
    }


    if (token) {
        requestHeaders.Authorization =
            `Bearer ${token}`
    }


    let response: Response


    try {
        response = await fetch(
            url,
            {
                ...requestOptions,
                headers:
                    requestHeaders,
            }
        )
    } catch {
        throw new ApiError(
            0,
            'Unable to connect to the banking API.'
        )
    }


    if (!response.ok) {
        if (
            authenticated &&
            response.status === 401
        ) {
            throw new ApiError(
                401,
                'Your login session has expired or is invalid.'
            )
        }


        throw new ApiError(
            response.status,
            `Banking API returned ${response.status}.`
        )
    }


    if (
        response.status === 204
    ) {
        return undefined as T
    }


    try {
        return await response.json() as T
    } catch {
        throw new ApiError(
            response.status,
            'The banking API returned an invalid response.'
        )
    }
}


export function apiGet<T>(
    url: string
): Promise<T> {
    return apiRequest<T>(
        url,
        {
            method: 'GET',
        }
    )
}


export function apiPostJson<T>(
    url: string,
    body: unknown,
    headers:
        Record<string, string> = {},
    journey?: Journey
): Promise<T> {
    return apiRequest<T>(
        url,
        {
            method: 'POST',

            journey,

            headers: {
                'Content-Type':
                    'application/json',

                ...headers,
            },

            body: JSON.stringify(
                body
            ),
        }
    )
}


export function apiPostForm<T>(
    url: string,
    body: URLSearchParams,
    journey?: Journey
): Promise<T> {
    return apiRequest<T>(
        url,
        {
            method: 'POST',

            authenticated: false,

            journey,

            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded',
            },

            body,
        }
    )
}
