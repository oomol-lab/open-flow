import type { ProviderIconRequest } from '../../../connector/common/providerIconCache.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ContentIcon, IconImageCrossOriginContext, imageIcon, initialsIcon, spriteIcon } from './ContentIcon.tsx'
import { IconThemeContext } from './iconTheme.ts'
const status = vi.hoisted(() => ({ value: 'loaded', requests: [] as { request: ProviderIconRequest; crop?: unknown }[] }))
vi.mock('./providerIconResource.ts', () => ({
  useProviderIconResource: (request: ProviderIconRequest, crop?: unknown) => {
    status.requests.push({ request, crop })
    return { status: status.value, url: 'data:image/png;base64,Y3JvcA==' }
  },
}))
const metadata = {
  version: 'v1',
  pixelRatio: 2,
  iconSize: 48,
  bleed: 2,
  width: 104,
  height: 52,
  lightUrl: 'https://example.com/light.png',
  darkUrl: 'https://example.com/dark.png',
}
const fallback = imageIcon('https://example.com/icon.svg', initialsIcon('AB'))
const src = spriteIcon({ iconSprite: metadata, iconSpritePosition: { x: 54, y: 2 } }, fallback)
beforeEach(() => {
  status.value = 'loaded'
  status.requests = []
})
it.each(['light', 'dark'] as const)('selects only the %s sprite and crops physical pixels', (theme) => {
  const html = renderToStaticMarkup(
    <IconThemeContext.Provider value={theme}>
      <ContentIcon src={src} />
    </IconThemeContext.Provider>,
  )
  expect(status.requests).toEqual([
    { request: { kind: 'sprite', theme, url: metadata[theme == 'dark' ? 'darkUrl' : 'lightUrl'], version: 'v1' }, crop: undefined },
  ])
  expect(html).toContain('left:-112.5%')
  expect(html).toContain('width:216.66666666666666%')
  expect(html).not.toContain('icon.svg')
})
it('preserves space without loading the fallback while pending', () => {
  status.value = 'loading'
  const html = renderToStaticMarkup(<ContentIcon src={src} />)
  expect(html).toContain('<span')
  expect(html).not.toContain('background-image')
  expect(html).not.toContain('<img')
})
it('uses the original image after a shared failure', () => {
  status.value = 'failed'
  expect(renderToStaticMarkup(<ContentIcon src={src} />)).toContain('src="https://example.com/icon.svg"')
})

it('exports a cropped sprite instead of skipping directly to its fallback', () => {
  const html = renderToStaticMarkup(
    <IconImageCrossOriginContext.Provider value="anonymous">
      <ContentIcon src={src} fallback={<span>Default node icon</span>} />
    </IconImageCrossOriginContext.Provider>,
  )
  expect(html).toContain('src="data:image/png;base64,Y3JvcA=="')
  expect(html).not.toContain('Default node icon')
  expect(status.requests[0]?.crop).toEqual({ x: 54, y: 2, size: 48 })
})

it('uses the node fallback during export when a sprite has no original image', () => {
  status.value = 'failed'
  const html = renderToStaticMarkup(
    <IconImageCrossOriginContext.Provider value="anonymous">
      <ContentIcon
        src={spriteIcon({ iconSprite: metadata, iconSpritePosition: { x: 54, y: 2 } }, initialsIcon('AB'))}
        fallback={<span>Default node icon</span>}
      />
    </IconImageCrossOriginContext.Provider>,
  )
  expect(html).toContain('Default node icon')
})

it('requests readable images only inside the export surface', () => {
  const html = renderToStaticMarkup(
    <IconImageCrossOriginContext.Provider value="anonymous">
      <ContentIcon src={fallback} />
    </IconImageCrossOriginContext.Provider>,
  )
  expect(html).toContain('crossorigin="anonymous"')
  expect(renderToStaticMarkup(<ContentIcon src={fallback} />)).not.toContain('crossorigin')
})
