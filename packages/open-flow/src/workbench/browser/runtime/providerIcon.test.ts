import { expect, it } from 'vitest'
import { imageIcon, placeholderIcon } from '../../../ui/browser/icons/ContentIcon.tsx'
import { providerIcon } from './providerIcon.ts'

it('uses the provider image with a bundled placeholder fallback', () => {
  expect(providerIcon({ icon: ' https://example.com/icon.svg ', serviceId: 'example', serviceName: 'Example' })).toBe(
    imageIcon('https://example.com/icon.svg', placeholderIcon),
  )
})

it.each([undefined, '', '   '])('uses the same placeholder for missing artwork (%j), even with a homepage', (icon) => {
  expect(providerIcon({ icon, homepageUrl: 'https://example.com', serviceId: 'github', serviceName: 'GitHub' })).toBe(placeholderIcon)
  expect(providerIcon({ icon, serviceId: 'other', serviceName: 'Other Provider' })).toBe(placeholderIcon)
})

it('uses a valid runtime sprite with an image or placeholder fallback', () => {
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
  const spriteOnly = providerIcon({ ...provider, icon: undefined, iconSprite, iconSpritePosition: { x: 54, y: 2 } })
  expect(JSON.parse(decodeURIComponent(spriteOnly.slice(spriteOnly.indexOf(',') + 1))).fallback).toBe(placeholderIcon)
})
