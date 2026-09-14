import type { ComponentProps } from 'react'
import type { FrontendStory } from './stories.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import snapshots from 'virtual:lab-trigger-snapshots'
import { localizeTrigger } from '../../src/trigger/providers/localization.ts'
import { ApiError } from '../../src/workbench/browser/runtime/api.ts'
import { CreateEventSourceDialog } from '../../src/workbench/browser/runtime/createEventSourceDialog.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { FeishuEventFilters } from '../../src/workbench/browser/runtime/editor/feishuEventFilters.tsx'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { SourceForm } from '../../src/workbench/browser/runtime/eventSources.tsx'
import { EventSourceSetup } from '../../src/workbench/browser/runtime/eventSourceSetup.tsx'
import { FeishuEventPicker } from '../../src/workbench/browser/runtime/feishuEventPicker.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const sampleSource: NonNullable<ComponentProps<typeof SourceForm>['source']> = {
  version: 1,
  sourceId: 'source_demo',
  revision: 1,
  name: 'Demo events',
  provider: 'feishu_app_bot',
  appId: 'cli_demo',
  tenantKey: 'demo-tenant',
  connectionId: 'sample-bot',
  teamId: null,
  enabled: true,
  eventTypes: ['im.message.receive_v1'],
  manageSubscriptions: false,
  verificationTokenConfigured: true,
  encryptKeyConfigured: true,
  endpointUrl: 'https://flow.example/v1/event-sources/source_demo/events',
  verifiedAt: null,
  lastReceivedAt: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
  consumers: [],
}

const client: ComponentProps<typeof SourceForm>['client'] = {
  createConnectorConnectionPage: async () => 'https://connector.example/providers/feishu_app_bot',
  listEventSources: async () => ({ version: 1, sources: [] }),
  listEventSourceConnections: async () => [
    {
      connectionId: 'sample-bot',
      providerAccountId: 'cli_demo',
      displayName: 'Feishu · Demo bot',
      isDefault: true,
      serviceId: 'feishu_app_bot',
      status: 'active',
    },
  ],
  createEventSource: async () => {
    throw new Error('Preview only: changes are not saved.')
  },
  updateEventSource: async () => {
    throw new Error('Preview only: changes are not saved.')
  },
  deleteEventSource: async () => {},
}

const unavailableClient = {
  ...client,
  listEventSourceConnections: async () => {
    throw new Error('Connection service is unavailable.')
  },
}

function Forms({ language, dark, log }: { language: Parameters<FrontendStory['render']>[2]; dark: boolean; log: Parameters<FrontendStory['render']>[0] }) {
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme grid gap-6 p-6 text-sm text-foreground xl:grid-cols-2" data-theme={dark ? 'dark' : 'light'}>
        {(
          [
            ['Available account', client],
            ['Connection failure', unavailableClient],
            [
              'Console URL missing',
              {
                ...client,
                createConnectorConnectionPage: async () => {
                  throw new ApiError(503, 'connector.console-unconfigured', 'Console URL is missing.')
                },
              },
            ],
          ] as const
        ).map(([label, fixture]) => (
          <section key={label}>
            <h2 className="m-0 mb-4 text-sm font-medium">{label}</h2>
            <SourceForm client={fixture} teams={[{ id: 'demo', name: 'Demo team' }]} onCancel={() => log('Cancel')} onSaved={() => log('Saved')} />
          </section>
        ))}
        <section>
          <h2 className="m-0 mb-4 text-sm font-medium">No event sources</h2>
          <CreateEventSourceDialog
            client={client}
            teamId="demo"
            existingNames={[]}
            disabled={false}
            onCreated={() => log('Created')}
            onSelect={async () => true}
          />
          <p className="m-0 mt-2 text-sm leading-5 text-muted-foreground">{i18n.t('eventSources.noSources')}</p>
        </section>
        <section>
          <h2 className="m-0 mb-4 text-sm font-medium">Callback settings · existing app identity</h2>
          <SourceForm client={client} teams={[]} source={sampleSource} onCancel={() => log('Cancel edit')} onSaved={() => log('Saved')} />
        </section>
      </div>
    </I18nProvider>
  )
}

export const eventSourcesStory: FrontendStory = {
  group: 'Workbench',
  id: 'event-source-forms',
  title: 'Event Sources',
  description: 'Application selection, connection failure and callback settings using the production source form. No external requests or saved changes.',
  standalone: true,
  render: (log, dark, language) => <Forms log={log} dark={dark} language={language} />,
}

function Pickers({ language, dark }: { language: Parameters<FrontendStory['render']>[2]; dark: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [selected, setSelected] = useState(['im.message.receive_v1', 'example.event_v1'])
  const [flowEvents, setFlowEvents] = useState(['drive.file.edit_v1'])
  const [disabled, setDisabled] = useState(false)
  useStoryActions([{ label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) }])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme grid gap-6 p-6 text-foreground lg:grid-cols-2" data-theme={dark ? 'dark' : 'light'}>
        <section>
          <h2 className="m-0 mb-4 text-sm font-medium">Source · catalog and custom events</h2>
          <FeishuEventPicker value={selected} onChange={setSelected} disabled={disabled} />
        </section>
        <section>
          <h2 className="m-0 mb-4 text-sm font-medium">Flow · allowed events and stale selection</h2>
          <FeishuEventPicker value={flowEvents} onChange={setFlowEvents} allowedEvents={['im.message.receive_v1', 'example.event_v1']} disabled={disabled} />
        </section>
      </div>
    </I18nProvider>
  )
}

export const eventPickerStory: FrontendStory = {
  group: 'Workbench',
  id: 'feishu-event-picker',
  title: 'Feishu Events',
  description: 'Search, multiple selection and custom events; Flow choices are limited by their source.',
  standalone: true,
  render: (_log, dark, language) => <Pickers dark={dark} language={language} />,
}

function CreateDialogStory({
  language,
  dark,
  log,
}: {
  language: Parameters<FrontendStory['render']>[2]
  dark: boolean
  log: Parameters<FrontendStory['render']>[0]
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const created = useRef<typeof sampleSource | undefined>(undefined)
  const [failBinding, setFailBinding] = useState(false)
  useStoryActions([{ label: failBinding ? 'Binding: fail' : 'Binding: succeed', onClick: () => setFailBinding(!failBinding) }])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme p-6 text-foreground" data-theme={dark ? 'dark' : 'light'}>
        <CreateEventSourceDialog
          defaultOpen
          client={{
            ...client,
            listEventSources: async () => ({ version: 1, sources: created.current == null ? [] : [created.current] }),
            createEventSource: async (input) => {
              created.current = {
                ...sampleSource,
                name: input.name,
                connectionId: input.connectionId,
                teamId: input.teamId,
                eventTypes: input.eventTypes,
                manageSubscriptions: input.manageSubscriptions,
              }
              return created.current
            },
          }}
          teamId="demo"
          existingNames={[]}
          disabled={false}
          onCreated={(source) => log(`Created ${source.name}`)}
          onSelect={async () => {
            log(failBinding ? 'Binding failed' : 'Selected')
            return !failBinding
          }}
        />
      </div>
    </I18nProvider>
  )
}

export const createEventSourceStory: FrontendStory = {
  group: 'Workbench',
  id: 'create-event-source',
  title: 'Create Event Source',
  standalone: true,
  description: 'Flow creation dialog with a fixed team, callback setup and retryable binding. Saves sample data locally.',
  render: (log, dark, language) => <CreateDialogStory log={log} dark={dark} language={language} />,
}

function SetupStates({ language, dark }: { language: Parameters<FrontendStory['render']>[2]; dark: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [source, setSource] = useState(sampleSource)
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme grid gap-6 p-6 text-foreground xl:grid-cols-3" data-theme={dark ? 'dark' : 'light'}>
        <section className="rounded-lg border border-border p-4">
          <h2 className="mt-0 text-base font-medium">Awaiting verification → Check to verify</h2>
          <EventSourceSetup
            source={source}
            onChange={setSource}
            client={{ listEventSources: async () => ({ version: 1, sources: [{ ...sampleSource, verifiedAt: sampleSource.updatedAt }] }) }}
          />
        </section>
        <section className="rounded-lg border border-border p-4">
          <h2 className="mt-0 text-base font-medium">Verified · no business events yet</h2>
          <EventSourceSetup
            source={{ ...sampleSource, verifiedAt: sampleSource.updatedAt }}
            onChange={() => {}}
            client={{
              listEventSources: async () => {
                throw new Error('Connection unavailable. Try again.')
              },
            }}
          />
        </section>
        <section className="rounded-lg border border-border p-4">
          <h2 className="mt-0 text-base font-medium">Public URL missing</h2>
          <EventSourceSetup source={{ ...sampleSource, endpointUrl: null }} onChange={() => {}} client={client} />
        </section>
      </div>
    </I18nProvider>
  )
}

export const eventSourceSetupStory: FrontendStory = {
  group: 'Workbench',
  id: 'event-source-setup',
  title: 'Event Source Setup',
  standalone: true,
  description: 'Callback setup instructions, verification, request failure and missing public URL using production components.',
  render: (_log, dark, language) => <SetupStates dark={dark} language={language} />,
}

function FilterSample({
  events,
  initial,
  managed,
  title,
  dark,
  disabled,
}: {
  events: string[]
  initial: ComponentProps<typeof FeishuEventFilters>['config']
  managed: boolean
  title: string
  dark: boolean
  disabled: boolean
}) {
  const [config, setConfig] = useState(initial)
  return (
    <EditorContextPanel icon="trigger" title={title} theme={dark ? 'dark' : 'light'} focusOnOpen={false} onClose={() => {}}>
      <FeishuEventFilters
        config={config}
        events={events}
        managed={managed}
        disabled={disabled}
        onChange={(name, value) =>
          setConfig((current) => {
            const next = { ...current }
            if (value === undefined) delete next[name]
            else next[name] = value
            return next
          })
        }
      />
    </EditorContextPanel>
  )
}

function FilterStates({ language, dark }: { language: Parameters<FrontendStory['render']>[2]; dark: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  useStoryActions([{ label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) }])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme grid gap-6 p-6 text-foreground xl:grid-cols-2" data-theme={dark ? 'dark' : 'light'}>
        <FilterSample title="Messages · optional chats" events={['im.message.receive_v1']} initial={{}} managed={false} dark={dark} disabled={disabled} />
        <FilterSample title="Document · subscription off" events={['drive.file.edit_v1']} initial={{}} managed dark={dark} disabled={disabled} />
        <FilterSample
          title="Document · subscription on"
          events={['drive.file.edit_v1']}
          initial={{ resource: { kind: 'document', id: 'doc-token', documentType: 'docx' } }}
          managed
          dark={dark}
          disabled={disabled}
        />
        <FilterSample
          title="Calendar · subscription on"
          events={['calendar.calendar.event.changed_v4']}
          initial={{ resource: { kind: 'calendar', id: 'calendar-id' } }}
          managed
          dark={dark}
          disabled={disabled}
        />
        <FilterSample title="Resource management unavailable" events={['approval_instance']} initial={{}} managed={false} dark={dark} disabled={disabled} />
        <FilterSample
          title="Old incompatible configuration"
          events={['contact.user.created_v3']}
          initial={{ resource: { kind: 'document', id: 'old' } }}
          managed
          dark={dark}
          disabled={disabled}
        />
      </div>
    </I18nProvider>
  )
}

export const feishuFiltersStory: FrontendStory = {
  group: 'Workbench',
  id: 'feishu-event-filters',
  title: 'Feishu Event Filters',
  standalone: true,
  description: 'Conditional chat filters and resource subscription forms, including disabled and incompatible settings.',
  render: (_log, dark, language) => <FilterStates language={language} dark={dark} />,
}

function SummarySample({ language }: { language: Parameters<FrontendStory['render']>[2] }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const definition = snapshots.find((item) => item.key == 'feishu_app_bot.on_event')!
  const [display, setDisplay] = useState<ComponentProps<typeof TriggerSummary>['display']>()
  useEffect(() => {
    let current = true
    void localizeTrigger(definition, language).then((value) => {
      if (current) setDisplay(value)
    })
    return () => {
      current = false
    }
  }, [definition, language])
  if (definition.type != 'integration') throw new Error('Expected an integration trigger fixture.')
  return (
    <I18nProvider i18n={i18n}>
      <section>
        <h2 className="text-sm font-medium">{language}</h2>
        <TriggerSummary trigger={{ kind: 'integration', name: 'Feishu', bindingId: 'sample', definition, config: {} }} display={display} />
      </section>
    </I18nProvider>
  )
}

export const feishuSummaryStory: FrontendStory = {
  group: 'Workbench',
  id: 'feishu-trigger-summary',
  title: 'Feishu Trigger Summary',
  standalone: true,
  description: 'Localized descriptions from the provider catalog; protocol identifiers remain unchanged.',
  render: (_log, dark) => (
    <div className="open-flow-theme grid gap-6 p-6 text-foreground lg:grid-cols-2" data-theme={dark ? 'dark' : 'light'}>
      <SummarySample language="zh-CN" />
      <SummarySample language="en" />
    </div>
  ),
}
