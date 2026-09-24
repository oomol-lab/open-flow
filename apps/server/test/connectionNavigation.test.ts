import { describe, expect, it } from 'vitest'
import { connectionHref } from '../browser/connectionNavigation.ts'

describe('connection navigation', () => {
  it.each(['com', 'dev'])('builds OOMOL .%s console links with the Flow team', (domain) => {
    const console = { origin: `https://console.oomol.${domain}/`, teamScoped: true }
    expect(connectionHref(console, 'Team / A', 'mail/service')).toBe(`https://console.oomol.${domain}/team/Team%20%2F%20A/connections/mail%2Fservice`)
    const url = new URL(connectionHref(console, 'Team / A', 'mail/service', 'account /?#&')!)
    expect(url.searchParams.get('app')).toBe('account /?#&')
    expect(url.pathname).toBe('/team/Team%20%2F%20A/connections/mail%2Fservice')
    expect(connectionHref(console, undefined, 'mail')).toBeUndefined()
  })

  it('builds self-hosted console links without a team', () => {
    const console = { origin: 'https://console.example.com/base/', teamScoped: false }
    expect(connectionHref(console, undefined, 'mail')).toBe('https://console.example.com/base/providers/mail')
    expect(connectionHref(console, 'ignored-team', 'mail', 'work')).toBe('https://console.example.com/base/providers/mail?app=work')
  })

  it('does not invent a destination when no console is configured', () => {
    expect(connectionHref(undefined, 'team', 'mail')).toBeUndefined()
  })
})
