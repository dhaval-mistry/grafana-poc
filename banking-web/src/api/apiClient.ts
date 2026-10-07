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
    }


async function apiRequest<T>(
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
        Record<string, string> = {}
): Promise<T> {
    return apiRequest<T>(
        url,
        {
            method: 'POST',

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
    body: URLSearchParams
): Promise<T> {
    return apiRequest<T>(
        url,
        {
            method: 'POST',

            authenticated: false,

            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded',
            },

            body,
        }
    )
}