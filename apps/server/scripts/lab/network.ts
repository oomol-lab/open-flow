/** The standalone Lab never follows a request into a real external service. */
export const labOrigins = new Set<string>()
export function labFetch(original: typeof fetch, origins: ReadonlySet<string>): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!origins.has(url.origin)) throw new Error(`Lab blocked an unconfigured HTTP destination: ${url.origin}`)
    const response = await original(input, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      await response.body?.cancel()
      throw new Error('Lab external adapters do not follow redirects.')
    }
    return response
  }
}
