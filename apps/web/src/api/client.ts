const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)

  if (!res.ok) {
    // The API's error middleware always responds with `{ error: string }`.
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}`)
  }

  return (await res.json()) as T
}
