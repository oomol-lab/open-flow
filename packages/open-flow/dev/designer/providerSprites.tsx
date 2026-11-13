import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { CanvasNodeIcon } from '../../src/canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import { ProviderIconCache } from '../../src/connector/common/providerIconCache.ts'
import { ContentIcon } from '../../src/ui/browser/icons/ContentIcon.tsx'
import { IconThemeContext } from '../../src/ui/browser/icons/iconTheme.ts'
import { indexedDbIconDelegate, ProviderIconCacheContext } from '../../src/ui/browser/icons/providerIconResource.ts'
import { ProviderAppIcon } from '../../src/workbench/browser/runtime/editor/providerAppIcon.tsx'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
import { sampleSprite } from './fixtures/providerSprite.ts'
import { useStoryActions } from './storyActions.tsx'

const fallback = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path fill="#d68b16" d="M24 2 46 46H2z"/></svg>')}`
const base = { serviceId: 'sample', serviceName: 'Sample Provider', icon: fallback }
const samples = [
  { label: 'Sprite square', src: providerIcon({ ...base, iconSprite: sampleSprite, iconSpritePosition: { x: 2, y: 2 } }) },
  { label: 'Sprite circle', src: providerIcon({ ...base, iconSprite: sampleSprite, iconSpritePosition: { x: 54, y: 2 } }) },
  {
    label: 'Failed sprite → original icon',
    src: providerIcon({
      ...base,
      iconSprite: { ...sampleSprite, lightUrl: 'data:image/png,broken', darkUrl: 'data:image/png,broken' },
      iconSpritePosition: { x: 2, y: 2 },
    }),
  },
  { label: 'No sprite → original icon', src: providerIcon(base) },
  { label: 'No artwork → placeholder', src: providerIcon({ serviceId: 'unknown', serviceName: 'Sample Provider' }) },
  { label: 'Failed image → placeholder', src: providerIcon({ ...base, icon: 'data:image/png,broken' }) },
  {
    label: 'Failed sprite and image → placeholder',
    src: providerIcon({
      ...base,
      icon: 'data:image/png,broken',
      iconSprite: { ...sampleSprite, lightUrl: 'data:image/png,broken', darkUrl: 'data:image/png,broken' },
      iconSpritePosition: { x: 2, y: 2 },
    }),
  },
]

function CachedSprites({ dark }: { readonly dark: boolean }) {
  const [version, setVersion] = useState(1)
  const [generation, setGeneration] = useState(0)
  const [offline, setOffline] = useState(false)
  const [downloads, setDownloads] = useState(0)
  const [delegate] = useState(indexedDbIconDelegate)
  const cache = useMemo(
    () =>
      new ProviderIconCache({
        scope: 'lab-provider-sprites',
        storage: delegate,
        mode: offline ? 'offline' : 'default',
        fetch: async (input) => {
          setDownloads((value) => value + 1)
          const url = String(input)
          if (url.includes('/failed/')) return new Response(null, { status: 503 })
          const source = url.includes('/dark.') ? sampleSprite.darkUrl : sampleSprite.lightUrl
          return new Response(decodeURIComponent(source.slice(source.indexOf(',') + 1)), { headers: { 'content-type': 'image/svg+xml' } })
        },
      }),
    [delegate, generation, offline],
  )
  const identity = version < 0 ? 'failed' : String(version)
  const icon = providerIcon({
    ...base,
    icon: undefined,
    iconSprite: {
      ...sampleSprite,
      version: identity,
      lightUrl: `https://provider-sprites.lab.invalid/${identity}/light.svg`,
      darkUrl: `https://provider-sprites.lab.invalid/${identity}/dark.svg`,
    },
    iconSpritePosition: { x: 54, y: 2 },
  })
  useStoryActions([
    { label: 'Next sprite version', onClick: () => setVersion((value) => Math.max(1, value + 1)) },
    { label: 'Reload cache instance', onClick: () => setGeneration((value) => value + 1) },
    { label: 'Simulate failed version', onClick: () => setVersion(-1) },
    { label: offline ? 'Allow downloads' : 'Use offline cache', onClick: () => setOffline((value) => !value) },
  ])
  return (
    <ProviderIconCacheContext.Provider value={cache}>
      <IconThemeContext.Provider value={dark ? 'dark' : 'light'}>
        <section className="space-y-2">
          <h3>Cached sprite only</h3>
          <div className="flex items-center gap-6">
            <ContentIcon src={icon} className="size-6" />
            <ProviderAppIcon src={icon} />
            <CanvasNodeIcon kind="task" icon={icon} className="size-8" />
          </div>
          <p>
            Version {identity} · Downloads {downloads}
          </p>
        </section>
      </IconThemeContext.Provider>
    </ProviderIconCacheContext.Provider>
  )
}
export const providerSpritesStory: FrontendStory = {
  group: 'Workbench',
  id: 'provider-sprites',
  title: 'Provider Sprites',
  standalone: true,
  description:
    'Physical-pixel crops, placeholders and production canvas and picker icons. Toggle the theme to load the other sprite. Reload the cache instance to check IndexedDB reuse; change versions to replace a fixed slot. Offline mode must use matching cached artwork and failed versions must show the placeholder. Downloads count only fixture transport calls.',
  render: (_log, dark) => (
    <div className="open-flow-theme space-y-6 p-6" data-theme={dark ? 'dark' : 'light'}>
      <CachedSprites dark={dark} />
      {samples.map((sample) => (
        <section key={sample.label} className="space-y-2">
          <h3>{sample.label}</h3>
          <div className="flex items-center gap-6">
            {[16, 24, 32].map((size) => (
              <span key={size} style={{ fontSize: size }}>
                <ContentIcon src={sample.src} />
              </span>
            ))}
            <ProviderAppIcon src={sample.src} />
            <CanvasNodeIcon kind="task" icon={sample.src} className="size-6" />
          </div>
        </section>
      ))}
    </div>
  ),
}
