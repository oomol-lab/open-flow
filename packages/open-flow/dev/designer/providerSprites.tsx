import type { FrontendStory } from './stories.tsx'

import { CanvasNodeIcon } from '../../src/canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import { ContentIcon } from '../../src/ui/browser/icons/ContentIcon.tsx'
import { ProviderAppIcon } from '../../src/workbench/browser/runtime/editor/providerAppIcon.tsx'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
import { sampleSprite } from './fixtures/providerSprite.ts'

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
  { label: 'No artwork → initials', src: providerIcon({ serviceId: 'unknown', serviceName: 'Sample Provider' }) },
]
export const providerSpritesStory: FrontendStory = {
  group: 'Workbench',
  id: 'provider-sprites',
  title: 'Provider Sprites',
  standalone: true,
  description:
    'Physical-pixel crops at multiple sizes, shared failure fallback, and production canvas and picker icons. Toggle the Lab theme to load the other sprite.',
  render: (_log, dark) => (
    <div className="open-flow-theme space-y-6 p-6" data-theme={dark ? 'dark' : 'light'}>
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
