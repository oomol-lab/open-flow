import type { InputValues } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { DiagnosticItem } from '../../src/workbench/browser/runtime/editor/diagnostics.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { fixedInputValue, inputValues } from '../../src/flow/common/inputValue.ts'
import { triggerConfigFieldLabels } from '../../src/trigger/providers/fieldLabels.ts'
import { TriggerConfigEditor } from '../../src/workbench/browser/runtime/editor/triggerConfigEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { DiagnosticsPanel } from '../../src/workbench/browser/runtime/shell/diagnosticsPanel.tsx'

const inputs: readonly (InputPort | Group)[] = [
  { handle: 'owner', jsonSchema: { type: 'string' }, nullable: false, description: 'Repository owner.' },
  { handle: 'events', jsonSchema: { type: 'array', items: { type: 'string', enum: ['issues', 'push', 'release'] } }, nullable: false },
  { group: 'Options' },
  { handle: 'limit', jsonSchema: { type: 'integer' }, nullable: false, value: 10 },
  { handle: 'enabled', jsonSchema: { type: 'boolean' }, nullable: true, value: true },
  { handle: 'mode', jsonSchema: { type: 'string', enum: ['all', 'matching'] }, nullable: true },
  { handle: 'filters', jsonSchema: { type: 'object', properties: { branch: { type: 'string' } } }, nullable: true },
]

function ConfigStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [config, setConfig] = useState<InputValues>(() => ({
    ...inputValues({ owner: '', events: ['issues'], enabled: null, mode: 'all', filters: { branch: 'main' } }),
    limit: fixedInputValue(undefined),
  }))
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 480 }}>
        <TriggerConfigEditor
          inputs={inputs}
          fieldLabels={triggerConfigFieldLabels[language]['github.on_repo_event']}
          config={config}
          disabled={false}
          onReset={() => {
            setConfig({})
            log('Reset configuration')
          }}
          onResetValue={(name) => {
            const next = { ...config }
            delete next[name]
            setConfig(next)
            log('Reset configuration value', { name })
          }}
          onChange={(name, value) => {
            const next = { ...config }
            next[name] = fixedInputValue(value)
            setConfig(next)
            log('Save configuration', next)
          }}
        />
        <output aria-label="Saved configuration">{JSON.stringify(config)}</output>
        <h3>Read only</h3>
        <TriggerConfigEditor
          inputs={inputs}
          fieldLabels={triggerConfigFieldLabels[language]['github.on_repo_event']}
          config={config}
          disabled
          onChange={() => log('Unexpected read-only save')}
        />
      </div>
    </I18nProvider>
  )
}
export const triggerConfigStory: FrontendStory = {
  group: 'Trigger Provider',
  id: 'trigger-config',
  propertyPanel: true,
  title: 'Trigger Configuration',
  description: 'Fixed Provider inputs share node input controls. Compare localized required-field labels, defaults, groups, collections, and read-only values.',
  standalone: true,
  render: (log, dark, language) => <ConfigStory dark={dark} language={language} log={log} />,
}

const diagnosticItems: readonly DiagnosticItem[] = [
  {
    diagnostic: {
      code: 'trigger.connection-missing',
      column: 0,
      line: 1,
      message: 'Select a connection account for this Trigger.',
      path: '/document/graph/nodes/trigger/bindingId',
    },
    location: { nodeId: 'trigger', section: 'account' },
    scope: 'node',
  },
  {
    diagnostic: {
      code: 'trigger.config-incomplete',
      column: 0,
      fields: ['sourceId', 'eventTypes'],
      line: 1,
      message: 'Complete the required Trigger config fields: sourceId, eventTypes.',
      path: '/document/graph/nodes/trigger/config',
    },
    location: { nodeId: 'trigger', section: 'node' },
    scope: 'node',
  },
  {
    diagnostic: {
      code: 'trigger.config-incomplete',
      column: 0,
      fields: ['sourceId', 'eventTypes'],
      line: 1,
      message: 'Complete the required Trigger config fields: sourceId, eventTypes.',
      path: '/document/graph/nodes/second-trigger/config',
    },
    location: { nodeId: 'second-trigger', section: 'node' },
    scope: 'node',
  },
  {
    diagnostic: {
      code: 'flow.problem',
      column: 0,
      line: 1,
      message: 'A Flow-level issue outside this Trigger.',
      path: '/document/graph',
    },
    scope: 'flow',
  },
]

function DiagnosticsStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: 420, maxWidth: 560, position: 'relative' }}>
        <DiagnosticsPanel
          checked
          checking={false}
          items={diagnosticItems}
          nodes={
            new Map([
              ['trigger', { title: 'Application Event' }],
              ['second-trigger', { title: 'Application Event (2)' }],
            ])
          }
          onClose={() => log('Close diagnostics')}
          onRefresh={() => log('Refresh diagnostics')}
          onSelect={(item) => log('Select issue', item.diagnostic.code)}
          onSelectNode={(nodeId) => log('Select node', nodeId)}
        />
      </div>
    </I18nProvider>
  )
}

export const diagnosticsStory: FrontendStory = {
  group: 'Workbench',
  id: 'diagnostics-panel',
  title: 'Diagnostics',
  description: 'Issues are grouped by node, including two same-named Triggers and a separate Flow-level issue.',
  standalone: true,
  render: (log, dark, language) => <DiagnosticsStory dark={dark} language={language} log={log} />,
}
