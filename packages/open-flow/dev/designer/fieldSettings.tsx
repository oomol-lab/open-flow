import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Button } from '../../src/ui/browser/button.tsx'
import { Popover, PopoverTrigger } from '../../src/ui/browser/popover.tsx'
import { PortSettingsPanel } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

function Sample({ disabled, showNullable, log }: { showNullable: boolean; disabled: boolean; log: LogAction }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(true)
  const [port, setPort] = useState<InputPort>({
    handle: 'payload',
    description: disabled ? 'Structured result from the previous step' : '',
    jsonSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        active: { type: 'boolean' },
        details: { type: 'object', properties: { count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } },
      },
    },
    nullable: true,
  })
  return (
    <section className="editor-context-panel" style={{ width: 344, flexShrink: 0, minHeight: 650, padding: 12 }}>
      <h3 className="mb-3 text-xs font-medium">{disabled ? 'Read only' : showNullable ? 'Input / output' : 'Fixed value'}</h3>
      <div ref={setContainer} style={{ position: 'relative' }}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="outline" size="field" className="w-full" />}>{port.handle}</PopoverTrigger>
          <PortSettingsPanel
            showNullable={showNullable}
            container={container}
            side="bottom"
            positionMethod="absolute"
            port={port}
            names={['payload', 'reserved']}
            disabled={disabled}
            onChange={(next) => {
              setPort(next)
              log('Save field', next)
            }}
            onRemove={() => {
              setOpen(false)
              log('Remove field', port.handle)
            }}
          />
        </Popover>
      </div>
    </section>
  )
}

function FieldSettingsStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [version, setVersion] = useState(0)
  useStoryActions([{ label: 'Reset samples', onClick: () => setVersion((value) => value + 1) }])
  return (
    <I18nProvider i18n={i18n}>
      <div key={version} className="open-flow-workbench open-flow-theme flex min-w-max gap-6 p-6" data-theme={dark ? 'dark' : 'light'}>
        <Sample disabled={false} showNullable={false} log={log} />
        <Sample disabled={false} showNullable log={log} />
        <Sample disabled showNullable log={log} />
      </div>
    </I18nProvider>
  )
}

export const fieldSettingsStory: FrontendStory = {
  id: 'field-settings',
  title: 'Field Settings',
  group: 'Node Fixed Values',
  description:
    'Open production panels with editable and read-only fields. Toggle advanced settings to inspect stable positioning, nullability and Schema validation. Long Schema content scrolls with the panel; reserved is a duplicate field name.',
  standalone: true,
  render: (log, dark, language) => <FieldSettingsStory log={log} dark={dark} language={language} />,
}
