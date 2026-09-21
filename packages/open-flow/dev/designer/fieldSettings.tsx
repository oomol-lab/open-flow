import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Button } from '../../src/ui/browser/button.tsx'
import { Popover, PopoverTrigger } from '../../src/ui/browser/popover.tsx'
import { FieldSectionTitle } from '../../src/workbench/browser/runtime/editor/fieldSectionHeader.tsx'
import { GroupSettingsPanel, PortSettingsPanel } from '../../src/workbench/browser/runtime/editor/portSettings.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

function Sample({ sectionTitle, disabled, showNullable, log }: { sectionTitle: string; showNullable: boolean; disabled: boolean; log: LogAction }) {
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
            sectionTitle={
              <FieldSectionTitle icon={sectionTitle === 'Inputs' ? 'input' : sectionTitle === 'Outputs' ? 'output' : undefined}>
                {sectionTitle}
              </FieldSectionTitle>
            }
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
        <Sample sectionTitle="Values" disabled={false} showNullable={false} log={log} />
        <Sample sectionTitle="Inputs" disabled={false} showNullable log={log} />
        <Sample sectionTitle="Outputs" disabled showNullable log={log} />
      </div>
    </I18nProvider>
  )
}

export const fieldSettingsStory: FrontendStory = {
  id: 'field-settings',
  title: 'Field Settings',
  group: 'Node Fixed Values',
  propertyPanel: true,
  description:
    'Open production panels with editable and read-only fields. Removal is immediate; toggle advanced settings to inspect stable positioning, nullability and Schema validation. Long Schema content scrolls with the panel; reserved is a duplicate field name.',
  standalone: true,
  render: (log, dark, language) => <FieldSettingsStory log={log} dark={dark} language={language} />,
}

function GroupSettingsStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(true)
  const [group, setGroup] = useState<Group>({ group: 'Structured data' })
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme p-6" data-theme={dark ? 'dark' : 'light'}>
        <section className="editor-context-panel min-h-[360px] w-[344px] p-3">
          <h3 className="mb-3 text-xs font-medium">Input / output group</h3>
          <div ref={setContainer} className="relative">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger render={<Button variant="outline" size="field" className="w-full" />}>{group.group}</PopoverTrigger>
              <GroupSettingsPanel
                sectionTitle="Inputs"
                container={container}
                side="bottom"
                positionMethod="absolute"
                group={group}
                onChange={(next) => {
                  setGroup(next)
                  log('Save group', next)
                }}
                onRemove={() => {
                  setOpen(false)
                  log('Remove group', group.group)
                }}
              />
            </Popover>
          </div>
        </section>
      </div>
    </I18nProvider>
  )
}

export const groupSettingsStory: FrontendStory = {
  id: 'group-settings',
  title: 'Group Settings',
  group: 'Node Task',
  propertyPanel: true,
  description: 'Edit an input/output group in the production secondary panel and inspect the immediate removal action.',
  standalone: true,
  render: (log, dark, language) => <GroupSettingsStory log={log} dark={dark} language={language} />,
}
