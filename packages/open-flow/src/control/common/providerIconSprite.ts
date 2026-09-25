/** Coordinates and dimensions are physical pixels in the sprite image. */
export interface ProviderIconSprite {
  readonly version: string
  readonly pixelRatio: number
  readonly iconSize: number
  readonly bleed: number
  readonly width: number
  readonly height: number
  readonly lightUrl: string
  readonly darkUrl: string
}
export interface ProviderIconAppearance {
  readonly iconSprite?: ProviderIconSprite
  readonly iconSpritePosition?: { readonly x: number; readonly y: number }
}

/** One sprite sheet serves all provider positions in a catalog response. */
export interface ProviderIconSpriteCatalog {
  readonly iconSprite: ProviderIconSprite
  readonly positions: Readonly<Record<string, NonNullable<ProviderIconAppearance['iconSpritePosition']>>>
}

/** Optional artwork must never make an otherwise usable catalog unavailable. */
export function providerIconAppearance(metadata: unknown, position: unknown): ProviderIconAppearance {
  if (!metadata || typeof metadata != 'object' || !position || typeof position != 'object') return {}
  const m = metadata as ProviderIconSprite
  const p = position as { x: number; y: number }
  if (
    typeof m.version != 'string' ||
    ![m.pixelRatio, m.iconSize, m.width, m.height].every((v) => Number.isInteger(v) && v > 0) ||
    ![m.bleed, p.x, p.y].every((v) => Number.isInteger(v) && v >= 0) ||
    p.x + m.iconSize > m.width ||
    p.y + m.iconSize > m.height
  )
    return {}
  try {
    for (const url of [m.lightUrl, m.darkUrl]) if (typeof url != 'string' || !['https:', 'http:', 'data:'].includes(new URL(url).protocol)) return {}
  } catch {
    return {}
  }
  return { iconSprite: m, iconSpritePosition: { x: p.x, y: p.y } }
}
