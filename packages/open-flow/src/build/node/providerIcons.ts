import type { Plugin } from 'vite'
import type { ProviderIconSprite, ProviderIconSpriteCatalog } from '../../control/common/providerIconSprite.ts'

import { providerIconAppearance } from '../../control/common/providerIconSprite.ts'

const catalogUrl = 'https://connector.oomol.com/public/v1/apps'
const catalogTimeoutMs = 5_000
const emptyModule = serializeProviderIcons({})
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
  try {
    const response = await fetch(catalogUrl, { signal: AbortSignal.timeout(catalogTimeoutMs) })
    if (!response.ok) return emptyModule

    const payload = (await response.json()) as { readonly data?: unknown; readonly meta?: { readonly iconSprite?: unknown } }
    if (!Array.isArray(payload.data)) return emptyModule

    const iconUrls: Record<string, string> = {}
    let iconSprite: ProviderIconSprite | undefined
    const positions: Record<string, ProviderIconSpriteCatalog['positions'][string]> = {}
    for (const item of payload.data) {
      if (!item || typeof item != 'object') continue
      const candidate = item as { readonly iconUrl?: unknown; readonly service?: unknown; readonly iconSpritePosition?: unknown }
      if (typeof candidate.service == 'string') {
        const appearance = providerIconAppearance(payload.meta?.iconSprite, candidate.iconSpritePosition)
        if (appearance.iconSprite && appearance.iconSpritePosition) {
          iconSprite = appearance.iconSprite
          positions[candidate.service] = appearance.iconSpritePosition
        }
      }
      if (typeof candidate.service == 'string' && typeof candidate.iconUrl == 'string' && candidate.iconUrl.trim()) {
        iconUrls[candidate.service] = candidate.iconUrl
      }
    }
    return serializeProviderIcons(iconUrls, iconSprite == null ? null : { iconSprite, positions })
  } catch {
    return emptyModule
  }
}

function serializeProviderIcons(iconUrls: Readonly<Record<string, string>>, spriteCatalog: ProviderIconSpriteCatalog | null = null): string {
  return `export const spriteCatalog = ${JSON.stringify(spriteCatalog)};export default ${JSON.stringify(iconUrls)};`
}
