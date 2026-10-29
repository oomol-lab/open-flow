import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { httpRequestConfigSchema, httpRequestTask } from '../../src/http/common/httpRequest.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const task = (config: unknown) => httpRequestTask(httpRequestConfigSchema.parse(config))
function content(): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: { token: { kind: 'variable', target: 'API_TOKEN' } },
      graph: {
        edges: ['get', 'post', 'object', 'invalid'].map((target) => ({ source: 'parameters', target })),
        nodes: {
          parameters: {
            kind: 'value',
            name: 'Request data',
            inputs: {},
            values: [
              {
                handle: 'query',
                jsonSchema: {
                  type: 'object',
                  properties: { page: { type: 'integer' }, tag: { type: 'array', items: { type: 'string' } } },
                  additionalProperties: false,
                },
                nullable: false,
                value: { page: 2, tag: ['a', 'b'] },
              },
              {
                handle: 'headers',
                jsonSchema: { type: 'object', properties: { Accept: { type: 'string' } }, additionalProperties: false },
                nullable: false,
                value: { Accept: 'application/json' },
              },
              { handle: 'client', jsonSchema: { type: 'string' }, nullable: false, value: 'Workbench' },
            ],
          },
          get: {
            kind: 'task',
            name: 'GET',
            task: task({}),
            inputs: {
              url: { kind: 'value', value: 'https://example.test/items' },
            },
          },
          post: {
            kind: 'task',
            name: 'JSON POST',
            task: task({
              method: 'POST',
              bodyFormat: 'json',
              authentication: { type: 'bearer' },
              query: { names: ['page'] },
              headers: { names: ['X-Client'] },
            }),
            inputs: {
              'url': { kind: 'value', value: 'https://example.test/items' },
              'body': {
                kind: 'value',
                value: { title: 'Example', enabled: true },
              },
              'query.page': { kind: 'value', value: 1 },
              'header.X-Client': { kind: 'value', value: 'Open Flow' },
              'auth.token': {
                kind: 'sources',
                sources: [{ kind: 'binding', bindingId: 'token' }],
              },
            },
          },
          object: {
            kind: 'task',
            name: 'Object inputs',
            task: task({
              query: { mode: 'object' },
              headers: { mode: 'object' },
            }),
            inputs: {
              url: { kind: 'value', value: 'https://example.test/items' },
              query: { kind: 'value', value: { tag: ['a', 'b'] } },
              headers: { kind: 'value', value: { Accept: 'application/json' } },
            },
          },
          invalid: {
            kind: 'task',
            name: 'Incomplete',
            task: task({
              bodyFormat: 'json',
              query: { names: ['page'] },
              authentication: { type: 'apiKey', name: '', in: 'header' },
            }),
            inputs: {},
          },
        },
      },
    },
  }
}
function HttpRequestStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [visible, setVisible] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [selected, setSelected] = useState('get')
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content())
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['get']))
    return () => next.dispose()
  }, [language])
  useStoryActions([
    ...['get', 'post', 'object', 'invalid'].map((id) => ({
      label: id,
      onClick: () => {
        setSelected(id)
        session?.store.selectNodes([id])
      },
    })),
    {
      label: visible ? 'Close panel' : 'Reopen panel',
      onClick: () => setVisible(!visible),
    },
    {
      label: disabled ? 'Enable editing' : 'Read only',
      onClick: () => setDisabled(!disabled),
    },
  ])
  return session == null ? null : <HttpPanel session={session} dark={dark} selected={selected} visible={visible} disabled={disabled} />
}
function HttpPanel({
  session,
  dark,
  selected,
  visible,
  disabled,
}: {
  session: ReturnType<typeof createInspectorSession>
  dark: boolean
  selected: string
  visible: boolean
  disabled: boolean
}) {
  const revision = useVal(session.store.$.revision)
  const selection = revision?.node(selected)
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', width: '100%' }}>
        {visible && revision != null && selection != null && (
          <InspectorSamplePanel disabled={disabled} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'} resizable>
            <NodeInspector
              connectors={session.connectors}
              triggers={session.triggers}
              disabled={disabled}
              variables={{
                enabled: true,
                names: ['API_TOKEN'],
                loaded: true,
                loading: false,
                onOpen: () => {},
              }}
              revision={revision}
              selection={selection}
              store={session.store}
              theme={dark ? 'dark' : 'light'}
            />
          </InspectorSamplePanel>
        )}
      </div>
    </I18nProvider>
  )
}
export const httpRequestStories: FrontendStory[] = [
  {
    id: 'http-request-properties',
    group: 'Node HTTP Request',
    title: 'Properties',
    description:
      'Request, Authentication, and Response settings are separate sections. URL comes before Method; Request body stays beside its format and credentials beside their authentication type. Edit Query and Headers as objects. Bind the whole object or individual fields to Request data, add and rename fields, and reopen the panel. The invalid sample checks editing and saving with configuration errors. Check that Request body and Response outputs distinguish sent and received data. Focus Method, then hover Request body format to inspect its attached error.',
    standalone: true,
    render: (log, dark, language) => <HttpRequestStory dark={dark} language={language} log={log} />,
  },
]
