import styles from './ContentIcon.module.scss'
import type { ProviderIconAppearance } from '../../../control/common/providerIconSprite.ts'

import { clsx } from 'clsx'
import { useContext, useMemo, useState } from 'react'
import { providerIconAppearance } from '../../../control/common/providerIconSprite.ts'
import { IconifyIcon } from './IconifyIcon.tsx'
import { IconThemeContext } from './iconTheme.ts'
import { useSpriteStatus } from './spriteResource.ts'

export interface ContentIconProps {
  /** Image URL, Iconify source, or a descriptor created by imageIcon, initialsIcon, or spriteIcon. */
  src?: string
  /** Applied to the icon root, including image, sprite, and initials renderers. */
  className?: string
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  /** Fallback element if the `<img>` load failed. */
  fallback?: React.ReactNode
}

export const ContentIcon = ({ src, className, fallback = null, loading = 'lazy', decoding = 'async' }: ContentIconProps) => {
  const sprite = useMemo(() => parseSpriteIcon(src), [src])
  const image = useMemo(() => parseImageIcon(src), [src])
  const source = image?.source ?? src
  const result = useMemo(() => parseIconifyIcon(source), [source])
  const [error, setError] = useState<string>()
  const onError = () => setError(source)

  if (sprite) return <SpriteIcon {...{ className, fallback, loading, decoding }} sprite={sprite} />

  if (source?.startsWith(initialsIconPrefix)) {
    return (
      <span data-icon-kind="initials" aria-hidden="true" className={clsx(styles.initials, className)}>
        <span>{source.slice(initialsIconPrefix.length)}</span>
      </span>
    )
  }

  if (!source) {
    return fallback as React.ReactElement
  }
  if (source === error)
    return image == null ? (
      (fallback as React.ReactElement)
    ) : (
      <ContentIcon className={className} fallback={fallback} src={image.fallback} loading={loading} decoding={decoding} />
    )

  return result ? (
    <IconifyIcon collection={result.collection} icon={result.icon} color={result.color} className={className} onError={onError} />
  ) : (
    <img className={clsx(styles.img, className)} src={source} alt="" decoding={decoding} loading={loading} referrerPolicy="no-referrer" onError={onError} />
  )
}

const initialsIconPrefix = 'data:application/vnd.open-flow.initials,'

export function initialsIcon(initials: string): string {
  return `${initialsIconPrefix}${initials}`
}

const imageIconPrefix = 'data:application/vnd.open-flow.image-icon+json,'

export function imageIcon(source: string, fallback: string): string {
  return `${imageIconPrefix}${encodeURIComponent(JSON.stringify({ fallback, source }))}`
}

function parseImageIcon(src: string | undefined): { readonly fallback: string; readonly source: string } | undefined {
  if (!src?.startsWith(imageIconPrefix)) return
  try {
    const value = JSON.parse(decodeURIComponent(src.slice(imageIconPrefix.length))) as { readonly fallback?: unknown; readonly source?: unknown }
    if (typeof value.fallback == 'string' && typeof value.source == 'string') return { fallback: value.fallback, source: value.source }
  } catch {
    return
  }
}

export function parseIconifyIcon(src: string | undefined): { collection: string; icon: string; color: string } | null {
  // src = :{collection}:{icon}:{color}:
  if (src && src.length > 2 && src[0] === ':' && src.endsWith(':')) {
    const [, collection, icon, color] = src.split(':')
    if (collection && icon) {
      return { collection, icon, color: color || 'currentColor' }
    }
  }
  return null
}

const spriteIconPrefix = 'data:application/vnd.open-flow.sprite-icon+json,'
type SpriteDescriptor = Required<ProviderIconAppearance> & { readonly fallback: string }
export function spriteIcon(appearance: Required<ProviderIconAppearance>, fallback: string): string {
  return `${spriteIconPrefix}${encodeURIComponent(JSON.stringify({ ...appearance, fallback }))}`
}
function parseSpriteIcon(src?: string): SpriteDescriptor | undefined {
  if (!src?.startsWith(spriteIconPrefix)) return
  try {
    const value = JSON.parse(decodeURIComponent(src.slice(spriteIconPrefix.length)))
    const appearance = providerIconAppearance(value?.iconSprite, value?.iconSpritePosition)
    if (appearance.iconSprite && appearance.iconSpritePosition && typeof value.fallback == 'string')
      return { iconSprite: appearance.iconSprite, iconSpritePosition: appearance.iconSpritePosition, fallback: value.fallback }
  } catch {
    return
  }
}
function SpriteIcon({ sprite, ...props }: Omit<ContentIconProps, 'src'> & { sprite: SpriteDescriptor }) {
  const theme = useContext(IconThemeContext)
  const { iconSprite: m, iconSpritePosition: p } = sprite
  const url = theme == 'dark' ? m.darkUrl : m.lightUrl
  const status = useSpriteStatus(url)
  if (status == 'failed') return <ContentIcon {...props} src={sprite.fallback} />
  return (
    <span aria-hidden="true" className={clsx(styles.sprite, props.className)}>
      {status == 'loaded' && (
        <span
          style={{
            backgroundImage: `url(${JSON.stringify(url)})`,
            width: `${(m.width / m.iconSize) * 100}%`,
            height: `${(m.height / m.iconSize) * 100}%`,
            left: `${(-p.x / m.iconSize) * 100}%`,
            top: `${(-p.y / m.iconSize) * 100}%`,
          }}
        />
      )}
    </span>
  )
}
