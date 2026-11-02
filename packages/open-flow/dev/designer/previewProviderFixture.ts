import type { ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { AppCatalogResponse } from '@oomol-lab/resource-cache/oomol'

import { getAppCatalogCache } from '@oomol-lab/resource-cache/oomol'
import { setNodePositions } from '../../src/workbench/browser/runtime/canvasPresentation.ts'
import { sampleSprite } from './fixtures/providerSprite.ts'
import { publicationFixture } from './publicationFixture.ts'

const previewProviders: readonly ConnectorProvider[] = [
  { serviceId: 'sample-mail', serviceName: 'Sample Mail', iconSprite: sampleSprite, iconSpritePosition: { x: 2, y: 2 } },
  { serviceId: 'sample-files', serviceName: 'Sample Files', iconSprite: sampleSprite, iconSpritePosition: { x: 54, y: 2 } },
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
      authTypes: ['no_auth'],
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
      summary: { providerCount: 2, actionCount: 3, categoryCount: 0, oauthProviderCount: 0, apiKeyProviderCount: 0, healthyProviderCount: 2 },
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
        modules: {},
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
                    tools: ['sample-mail.search', 'sample-mail.read', 'sample-files.archive'].map((action) => ({
                      id: action,
                      name: action.replaceAll('.', '_'),
                      description: action,
                      action,
                      approval: false,
                      inputs: [],
                    })),
                  },
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
      value: setNodePositions({}, { mail: { x: 0, y: 0 }, agent: { x: 400, y: 0 } }),
    },
  }
}
