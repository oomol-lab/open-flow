import { describe, expect, it } from 'vitest'
import { providerIconSource, providerInitials } from './providerIcon.ts'

describe('providerIconSource', () => {
  it('prefers the provider icon', () => {
    expect(providerIconSource({ icon: ' https://example.com/icon.svg ', serviceId: 'example' }, { example: 'https://static.oomol.com/example.svg' })).toBe(
      'https://example.com/icon.svg',
    )
  })

  it('uses the bundled OOMOL catalog icon', () => {
    expect(providerIconSource({ serviceId: 'example' }, { example: 'https://static.oomol.com/example.svg' })).toBe('https://static.oomol.com/example.svg')
  })

  it('uses the homepage favicon when no icon is mapped', () => {
    expect(providerIconSource({ homepageUrl: 'https://example.com/docs', serviceId: 'example' }, {})).toBe(
      'https://www.google.com/s2/favicons?sz=64&domain=example.com',
    )
  })

  it('falls back to initials when no icon or valid homepage is available', () => {
    expect(providerIconSource({ homepageUrl: 'not a URL', serviceId: 'example' }, {})).toBeUndefined()
    expect(providerInitials('Google Drive')).toBe('GD')
  })
})
