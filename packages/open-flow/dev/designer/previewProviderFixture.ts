import type { ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { AppCatalogResponse } from '@oomol-lab/resource-cache/oomol'

import { getAppCatalogCache } from '@oomol-lab/resource-cache/oomol'
import { connectorProxyConfigSchema, connectorProxyTask } from '../../src/connector/common/proxy.ts'
import { setNodePositions } from '../../src/workbench/browser/runtime/canvasPresentation.ts'
import { sampleSprite } from './fixtures/providerSprite.ts'
import { publicationFixture } from './publicationFixture.ts'

const previewProviders: readonly ConnectorProvider[] = [
  { serviceId: 'sample-mail', serviceName: 'Sample Mail', noSetup: true, iconSprite: sampleSprite, iconSpritePosition: { x: 2, y: 2 } },
  { serviceId: 'sample-files', serviceName: 'Sample Files', noSetup: false, iconSprite: sampleSprite, iconSpritePosition: { x: 54, y: 2 } },
]

// Lab owns these shared initializers for its browser session, including Strict Mode remounts.
const catalogs = new Map<string, ReturnType<typeof createPreviewProviderCatalog>>()
export function previewProviderCatalog(locale: string) {
  const key = locale.toLowerCase()
  let catalog = catalogs.get(key)
  if (!catalog) {
    catalog = createPreviewProviderCatalog(key)
    catalogs.set(key, catalog)
  }
  return catalog
}

function createPreviewProviderCatalog(locale: string) {
  let resolve!: () => void
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  const response: AppCatalogResponse = {
    success: true,
    message: 'Lab catalog',
    data: previewProviders.map((item) => ({
      service: item.serviceId,
      displayName: item.serviceName,
      authTypes: [item.noSetup ? 'no_auth' : 'api_key'],
      categories: [],
      searchAliases: [],
      iconUrl: null,
      homepageUrl: null,
      iconSpritePosition: item.iconSpritePosition!,
      actionCount: 2,
      featuredActions: [],
      status: 'available',
    })),
    meta: {
      summary: { providerCount: 2, actionCount: 3, categoryCount: 0, oauthProviderCount: 0, apiKeyProviderCount: 1, healthyProviderCount: 2 },
      categories: [],
      authTypes: [],
      iconSprite: sampleSprite,
    },
  }
  const cache = getAppCatalogCache({
    locale: locale.toLowerCase(),
    schemaVersion: 1,
    maxAge: 300_000,
    decode: (value) => value as AppCatalogResponse,
    load: async () => {
      await ready
      return { modified: true, data: response, etag: null }
    },
  })
  return { cache, resolve }
}

export function previewProviderFixture() {
  const base = publicationFixture('preview-providers', 'provider-revision')
  return {
    draft: {
      ...base.draft,
      content: {
        ...base.draft.content,
        modules: {
          compile: {
            name: 'Compile research',
            imports: [],
            source: 'export default async (_, context) => {\n  const messages = await context.actions["sample-mail.search"]({});\n  return { messages };\n}',
          },
          ready: { name: 'Ready', imports: [], source: 'export default () => ({ status: "ready" })' },
        },
        document: {
          bindings: {},
          graph: {
            nodes: {
              mail: {
                kind: 'task' as const,
                name: 'Find recent mail',
                inputs: {},
                task: { name: 'Search', inputs: [], outputs: [], executor: { kind: 'connector' as const, action: 'sample-mail.search' } },
              },
              deferred: {
                kind: 'task' as const,
                name: 'Archive without an account',
                inputs: {},
                task: { name: 'Archive', inputs: [], outputs: [], executor: { kind: 'connector' as const, action: 'sample-files.archive', connectionId: '' } },
              },
              proxy: {
                kind: 'task' as const,
                name: 'Custom API request',
                inputs: { endpoint: { kind: 'value' as const, value: '/files' } },
                task: connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'sample-files' })),
              },
              agent: {
                kind: 'task' as const,
                name: 'Research and archive',
                inputs: {},
                task: {
                  name: 'Agent',
                  inputs: [],
                  outputs: [],
                  executor: {
                    kind: 'agent' as const,
                    model: 'sample-model',
                    prompt: 'Read related messages and archive the result.',
                    maxRounds: 10,
                    tools: ['sample-mail.search', 'sample-mail.read', 'sample-files.archive'].map((action, index) => ({
                      id: action,
                      name: index === 0 ? 'find_unread_messages_about_projects_and_release_updates' : action.replaceAll('.', '_'),
                      description: action,
                      action,
                      approval: false,
                      inputs:
                        index === 0
                          ? [
                              {
                                handle: 'query',
                                jsonSchema: { type: 'string' },
                                nullable: false,
                                source: { kind: 'value' as const, value: 'Unread messages about the latest project updates.' },
                              },
                            ]
                          : [],
                    })),
                  },
                },
              },
              code: {
                kind: 'task' as const,
                name: 'Compile research',
                inputs: {},
                task: {
                  name: 'Compile research',
                  moduleId: 'compile',
                  inputs: [],
                  outputs: [],
                  capabilities: [
                    {
                      kind: 'connector' as const,
                      mode: 'independent' as const,
                      actions: [
                        { action: 'sample-mail.search', connectionId: 'saved-mail-account' },
                        { action: 'sample-files.archive', connectionId: '' },
                      ],
                    },
                    { kind: 'workflow' as const, flowId: 'summarize', revisionId: 'saved-revision', name: 'summarize', inputs: [], outputs: [] },
                    { kind: 'http' as const, hosts: ['api.example.com', '*.example.org'] },
                  ],
                },
              },
              emptyCode: {
                kind: 'task' as const,
                name: 'Code without tools',
                inputs: {},
                task: {
                  name: 'Code without tools',
                  moduleId: 'ready',
                  inputs: [],
                  outputs: [],
                  capabilities: [{ kind: 'connector' as const, mode: 'independent' as const, actions: [] }],
                },
              },
            },
            edges: [{ source: 'mail', target: 'agent' }],
          },
        },
      },
    },
    presentation: {
      ...base.presentation,
      value: setNodePositions(
        {},
        {
          mail: { x: 0, y: 0 },
          agent: { x: 400, y: 0 },
          code: { x: 0, y: 350 },
          emptyCode: { x: 400, y: 350 },
          deferred: { x: 800, y: 0 },
          proxy: { x: 800, y: 350 },
        },
      ),
    },
  }
}
