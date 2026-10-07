const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

if (!apiBaseUrl) {
  throw new Error(
    'VITE_API_BASE_URL environment variable is not configured.'
  )
}

export const config = {
  apiBaseUrl,
}