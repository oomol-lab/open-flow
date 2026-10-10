/** Exchange an explicit development link for the normal HttpOnly session cookie. */
export async function signInFromDevelopmentLink(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const token = fragment.get('dev-token')
  if (token == null) return

  fragment.delete('dev-token')
  const remaining = fragment.toString()
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (remaining ? `#${remaining}` : ''))
  try {
    await fetch('/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, token }),
    })
  } catch {
    // Let the normal session check present the login screen if the server is unavailable.
  }
}
