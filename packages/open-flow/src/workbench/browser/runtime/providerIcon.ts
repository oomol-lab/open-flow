import providerIconUrls from 'virtual:oomol-provider-icons'
import { imageIcon } from '../../../designer/browser/icons/DesignerIcon.tsx'

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

function initialsIcon(initials: string): string {
  const text = [...initials].map((letter) => `&#${letter.codePointAt(0)};`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#e4e4e7"/><text x="32" y="33" fill="#3f3f46" font-family="Arial,sans-serif" font-size="25" font-weight="600" text-anchor="middle" dominant-baseline="central">${text}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
