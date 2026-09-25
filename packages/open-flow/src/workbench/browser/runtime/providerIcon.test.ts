import { describe, expect, it } from 'vitest'
import { providerIcon, providerIconSource, providerInitials } from './providerIcon.ts'

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

it('prefers a valid live sprite and preserves the original fallback chain', () => {
  const iconSprite = {
    version: 'v1',
    pixelRatio: 2,
    iconSize: 48,
    bleed: 2,
    width: 104,
    height: 52,
    lightUrl: 'https://example.com/light.png',
    darkUrl: 'https://example.com/dark.png',
  }
  const provider = { serviceId: 'example', serviceName: 'Example', icon: 'https://example.com/icon.svg' }
  const src = providerIcon({ ...provider, iconSprite, iconSpritePosition: { x: 54, y: 2 } })
  const descriptor = JSON.parse(decodeURIComponent(src.slice(src.indexOf(',') + 1)))
  expect(descriptor.iconSprite).toEqual(iconSprite)
  expect(descriptor.fallback).toBe(providerIcon(provider))
  expect(providerIcon({ ...provider, iconSprite, iconSpritePosition: { x: 999, y: 2 } })).toBe(providerIcon(provider))
})
