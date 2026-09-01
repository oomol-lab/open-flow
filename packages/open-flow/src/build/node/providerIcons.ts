import type { Plugin } from 'vite'

const catalogUrl = 'https://oomol.com/en/apps/catalog.json'
const publicModuleId = 'virtual:oomol-provider-icons'
const resolvedModuleId = `\0${publicModuleId}`

export function providerIconsPlugin(options: { readonly iconUrls?: Readonly<Record<string, string>> } = {}): Plugin {
  let cachedModule: Promise<string> | undefined

  return {
    name: 'oomol-provider-icons',
    resolveId(id): string | undefined {
      return id == publicModuleId ? resolvedModuleId : undefined
    },
    load(id): Promise<string> | undefined {
      if (id != resolvedModuleId) return
      cachedModule ??= options.iconUrls == null ? loadProviderIconsModule() : Promise.resolve(serializeProviderIcons(options.iconUrls))
      return cachedModule
    },
  }
}

async function loadProviderIconsModule(): Promise<string> {
  const response = await fetch(catalogUrl)
  if (!response.ok) throw new Error(`Could not load OOMOL provider icons: ${response.status} ${response.statusText}`)

  const payload = (await response.json()) as { readonly items?: unknown }
  if (!Array.isArray(payload.items)) throw new Error('Could not load OOMOL provider icons: catalog.items is not an array')

  const iconUrls: Record<string, string> = {}
  for (const item of payload.items) {
    const candidate = item as { readonly iconUrl?: unknown; readonly service?: unknown }
    if (typeof candidate.service == 'string' && typeof candidate.iconUrl == 'string' && candidate.iconUrl.trim()) {
      iconUrls[candidate.service] = candidate.iconUrl
    }
  }
  return serializeProviderIcons(iconUrls)
}

function serializeProviderIcons(iconUrls: Readonly<Record<string, string>>): string {
  return `export default ${JSON.stringify(iconUrls)};`
}
