import providerIconUrls from 'virtual:oomol-provider-icons'
import { imageIcon, initialsIcon } from '../../../ui/browser/icons/ContentIcon.tsx'

export function providerIcon(
  provider: { readonly homepageUrl?: string; readonly icon?: string; readonly serviceId: string; readonly serviceName: string },
  catalogIconUrls: Readonly<Record<string, string>> = providerIconUrls,
): string {
  const fallback = initialsIcon(providerInitials(provider.serviceName))
  const source = providerIconSource(provider, catalogIconUrls)
  return source == null ? fallback : imageIcon(source, fallback)
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
