import type { JsonValue, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { openApiTask, selectOperation } from '../../src/openapi/common/openapi.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const sample = {
  openapi: '3.1.0',
  security: [{ token: [] }],
  components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
  servers: [
    {
      url: 'https://api.example.test/{version}',
      variables: {
        version: {
          default: 'v1',
        },
      },
    },
  ],
  paths: {
    '/items/{id}': {
      get: {
        tags: ['Items'],
        summary: 'Read an item',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'limit',
            schema: {
              type: 'integer',
              default: 10,
            },
          },
        ] as JsonValue[],
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                    },
                    name: {
                      type: 'string',
                    },
                  },
                  required: ['id', 'name'],
                },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: [] as string[],
        summary: 'Check service health',
        responses: { '204': { description: 'Service is healthy' } },
      },
    },
    '/items': {
      get: {
        tags: ['Items'],
        summary:
          'List items with their names, availability and latest updates, filtered by the selected category and sorted by creation date. Results include pagination details for browsing the entire collection.',
        responses: { '200': { description: 'Matching items', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
      post: {
        tags: ['Items'],
        summary: 'Create an item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                  },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
function content(live: boolean): RevisionContent {
  const task = live
    ? {
        name: 'OpenAPI',
        inputs: [],
        outputs: [],
        executor: {
          kind: 'openapi' as const,
          sourceUrl: 'https://catfact.ninja/docs?api-docs.json',
          method: '',
          path: '',
          serverUrl: '',
          document: {},
          auth: [],
        },
      }
    : openApiTask({ ...selectOperation(sample, 'https://api.example.test/spec.json', '/items/{id}', 'get'), auth: [{ id: 'token', type: 'bearer' }] })
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: { token: { kind: 'variable', target: 'API_TOKEN' } },

      graph: {
        nodes: {
          upstream: {
            kind: 'value',
            name: 'Credentials',
            inputs: {},
            values: [{ handle: 'token', jsonSchema: { type: 'string' }, nullable: false, value: 'sample-token' }],
          },
          api: {
            kind: 'task',
            name: 'API',
            task: task,
            inputs: live
              ? {}
              : { 'path.id': { kind: 'value', value: 'sample' }, 'auth.token.token': { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] } },
          },
        },
        edges: [{ source: 'upstream', target: 'api' }],
      },
    },
  }
}
function OpenApiStory({ dark, language, log, live = false }: { dark: boolean; language: UiLanguage; log: LogAction; live?: boolean }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [visible, setVisible] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const failure = useRef(false)
  const changed = useRef(false)
  const untagged = useRef(false)
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content(live), {
      openApiDocument: async (url, signal) => {
        logRef.current('Load document', url)
        if (failure.current) {
          failure.current = false
          throw new Error('Document server is unavailable.')
        }
        if (live) {
          const response = await fetch(import.meta.env.DEV && url == 'https://catfact.ninja/docs?api-docs.json' ? '/__lab/openapi-catfacts' : url, {
            signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal == null ? [] : [signal])]),
            credentials: 'omit',
            redirect: 'error',
          })
          if (!response.ok) throw new Error('Document request failed.')
          return (await response.json()) as JsonValue
        }
        const result = structuredClone(sample)
        if (changed.current) result.paths['/items/{id}'].get.parameters.push({ in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } })
        if (untagged.current) {
          result.paths['/items/{id}'].get.tags = []
          result.paths['/items'].post.tags = []
          result.paths['/items'].get.tags = []
        }
        return result
      },
    })
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['api']))
    return () => next.dispose()
  }, [language, live])
  useStoryActions([
    { label: visible ? 'Close panel' : 'Reopen panel', onClick: () => setVisible(!visible) },
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
    {
      label: 'Fail next load',
      onClick: () => {
        failure.current = true
      },
    },
    ...(!live
      ? [
          {
            label: 'Use untagged document',
            onClick: () => {
              untagged.current = true
            },
          },
          {
            label: 'Use mixed tags',
            onClick: () => {
              untagged.current = false
            },
          },
          {
            label: 'Change remote definition',
            onClick: () => {
              changed.current = true
            },
          },
        ]
      : []),
  ])
  return session == null ? null : <OpenApiPanel session={session} dark={dark} visible={visible} disabled={disabled} />
}
function OpenApiPanel({
  session,
  dark,
  visible,
  disabled,
}: {
  session: ReturnType<typeof createInspectorSession>
  dark: boolean
  visible: boolean
  disabled: boolean
}) {
  const revision = useVal(session.store.$.revision)
  const selection = revision?.node('api')
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', width: '100%' }}>
        {visible && revision != null && selection != null && (
          <InspectorSamplePanel disabled={disabled} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'} resizable>
            <NodeInspector
              connectors={session.connectors}
              triggers={session.triggers}
              disabled={disabled}
              variables={{ enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: () => {} }}
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
export const openApiStories: FrontendStory[] = [
  {
    id: 'openapi-properties',
    group: 'Node OpenAPI',
    title: 'Properties',
    description:
      'Saved operation, variable/upstream authentication, server variables and updates. Authentication defaults to collapsed when valid and expanded when credentials are invalid. Switch authentication to inspect the separate credential section; API parameters remain in Inputs below OpenAPI and Authentication. Close and reopen the panel to release its document; opening a selector loads again. Change the remote definition and press Update to save the new definition directly.',
    standalone: true,
    render: (log, dark, language) => <OpenApiStory log={log} dark={dark} language={language} />,
  },
  {
    id: 'openapi-live',
    group: 'Node OpenAPI',
    title: 'Cat Facts',
    description:
      'Clear the URL to inspect the empty state. Update loads the operation selector; choose GET /fact to reveal parameters and response fields. Network access is only triggered by your actions.',
    standalone: true,
    render: (log, dark, language) => <OpenApiStory live log={log} dark={dark} language={language} />,
  },
]
