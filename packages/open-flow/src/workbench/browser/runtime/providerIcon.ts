import type { ProviderIconAppearance } from '../../../connector/common/providerIconSprite.ts'

import { providerIconAppearance } from '../../../connector/common/providerIconSprite.ts'
import { imageIcon, placeholderIcon, spriteIcon } from '../../../ui/browser/icons/ContentIcon.tsx'

export function providerIcon(
  provider: ProviderIconAppearance & { readonly homepageUrl?: string; readonly icon?: string; readonly serviceId: string; readonly serviceName: string },
): string {
  const source = provider.icon?.trim()
  const original = source ? imageIcon(source, placeholderIcon) : placeholderIcon
  const appearance = providerIconAppearance(provider.iconSprite, provider.iconSpritePosition)
  return appearance?.iconSprite && appearance.iconSpritePosition
    ? spriteIcon({ iconSprite: appearance.iconSprite, iconSpritePosition: appearance.iconSpritePosition }, original)
    : original
}
