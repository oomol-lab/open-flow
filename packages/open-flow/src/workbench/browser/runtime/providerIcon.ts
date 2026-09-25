import type { ProviderIconAppearance } from '../../../control/common/providerIconSprite.ts'

import providerIconUrls, { spriteCatalog } from 'virtual:oomol-provider-icons'
import { providerIconAppearance } from '../../../control/common/providerIconSprite.ts'
import { imageIcon, initialsIcon, spriteIcon } from '../../../ui/browser/icons/ContentIcon.tsx'

export function providerIcon(
  provider: ProviderIconAppearance & { readonly homepageUrl?: string; readonly icon?: string; readonly serviceId: string; readonly serviceName: string },
  catalogIconUrls: Readonly<Record<string, string>> = providerIconUrls,
): string {
  const fallback = initialsIcon(providerInitials(provider.serviceName))
  const source = providerIconSource(provider, catalogIconUrls)
  const original = source == null ? fallback : imageIcon(source, fallback)
  const live = providerIconAppearance(provider.iconSprite, provider.iconSpritePosition)
  const appearance = live.iconSprite ? live : { iconSprite: spriteCatalog?.iconSprite, iconSpritePosition: spriteCatalog?.positions[provider.serviceId] }
  return appearance?.iconSprite && appearance.iconSpritePosition
    ? spriteIcon({ iconSprite: appearance.iconSprite, iconSpritePosition: appearance.iconSpritePosition }, original)
    : original
}

export function providerIconSource(
  provider: { readonly homepageUrl?: string; readonly icon?: string; readonly serviceId: string },
  catalogIconUrls: Readonly<Record<string, string>> = providerIconUrls,
): string | undefined {
  const icon = provider.icon?.trim()
  if (icon) return icon

  const catalogIcon = catalogIconUrls[provider.serviceId]?.trim()
  if (catalogIcon) return catalogIcon

  const hostname = homepageHostname(provider.homepageUrl)
  return hostname == null ? undefined : `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`
}

export function providerInitials(displayName: string): string {
  return (
    displayName
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  )
}

function homepageHostname(homepageUrl: string | undefined): string | undefined {
  if (!homepageUrl) return
  try {
    return new URL(homepageUrl).hostname || undefined
  } catch {
    return
  }
}
