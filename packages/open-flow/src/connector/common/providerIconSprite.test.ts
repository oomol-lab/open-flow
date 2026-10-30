import { expect, it } from 'vitest'
import { providerIconAppearance } from './providerIconSprite.ts'
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
const iconSpritePosition = { x: 54, y: 2 }
it('accepts physical coordinates including bleed without scaling them', () => {
  expect(providerIconAppearance(iconSprite, iconSpritePosition)).toEqual({ iconSprite, iconSpritePosition })
})
it.each([null, {}, { ...iconSprite, iconSize: 0 }, { ...iconSprite, lightUrl: '' }])('ignores unsupported metadata %j', (metadata) => {
  expect(providerIconAppearance(metadata, iconSpritePosition)).toEqual({})
})
it('ignores missing and out-of-bounds positions', () => {
  expect(providerIconAppearance(iconSprite, null)).toEqual({})
  expect(providerIconAppearance(iconSprite, { x: 90, y: 2 })).toEqual({})
})
