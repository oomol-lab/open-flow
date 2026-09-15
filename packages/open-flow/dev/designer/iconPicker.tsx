import type { FrontendStory } from './stories.tsx'

import { IconPickerButton } from '../../src/ui/browser/icons/icon-picker-button.tsx'
import { IconPicker } from '../../src/ui/browser/icons/picker/IconPicker.tsx'

export const iconPickerStory: FrontendStory = {
  group: 'Workbench',
  id: 'icon-picker',
  title: 'Icon Picker',
  description: 'Emoji and Carbon catalogs, search, color selection, and the node icon popover.',
  standalone: true,
  render: (log, dark, language) => (
    <div className="open-flow-theme flex flex-wrap items-start gap-8 p-6" data-theme={dark ? 'dark' : 'light'}>
      {(['twemoji', 'carbon'] as const).map((tab) => (
        <section key={tab} className="space-y-3">
          <h3 className="text-sm font-medium">{tab === 'twemoji' ? 'Emoji' : 'Carbon'}</h3>
          <div className="overflow-hidden rounded-lg border border-foreground/10 bg-popover shadow-md">
            <IconPicker emoji defaultTab={tab} locale={language} onChange={(...value) => log('Select icon', value)} onCancel={() => log('Close picker')} />
          </div>
        </section>
      ))}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Node icon popover</h3>
        <IconPickerButton label="Choose icon" onChange={(value) => log('Change node icon', value)}>
          😀
        </IconPickerButton>
      </section>
    </div>
  ),
}
