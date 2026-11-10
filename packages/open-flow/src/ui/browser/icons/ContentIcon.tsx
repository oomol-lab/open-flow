import styles from './ContentIcon.module.scss'
import type { ProviderIconAppearance } from '../../../connector/common/providerIconSprite.ts'

import { clsx } from 'clsx'
import { createContext, useContext, useMemo, useState } from 'react'
import { providerIconAppearance } from '../../../connector/common/providerIconSprite.ts'
import { IconifyIcon } from './IconifyIcon.tsx'
import { IconThemeContext } from './iconTheme.ts'
import { useProviderIconResource } from './providerIconResource.ts'

/** Standalone image capture crops sprites and uses cross-origin-readable images. */
export const IconImageCrossOriginContext = createContext<'anonymous' | undefined>(undefined)

/** A bundled, theme-aware placeholder that does not load a remote icon. */
export const placeholderIcon = 'data:application/vnd.open-flow.placeholder-icon,'

export interface ContentIconProps {
  /** Image URL, Iconify source, placeholderIcon, or a descriptor created by imageIcon, initialsIcon, or spriteIcon. */
  src?: string
  /** Applied to the icon root, including image, sprite, and initials renderers. */
  className?: string
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  /** Fallback element if the `<img>` load failed. */
  fallback?: React.ReactNode
}

export const ContentIcon = ({ src, className, fallback = null, loading = 'lazy', decoding = 'async' }: ContentIconProps) => {
  const crossOrigin = useContext(IconImageCrossOriginContext)
  const sprite = useMemo(() => parseSpriteIcon(src), [src])
  const image = useMemo(() => parseImageIcon(src), [src])
  const source = image?.source ?? src
  const result = useMemo(() => parseIconifyIcon(source), [source])
  const [error, setError] = useState<string>()
  const onError = () => setError(source)

  if (sprite) return <SpriteIcon {...{ className, fallback, loading, decoding }} sprite={sprite} />
  if (image?.providerId) return <ProviderImage {...{ className, fallback, loading, decoding }} image={image as ProviderImageDescriptor} />

  if (source === placeholderIcon) return <i aria-hidden="true" className={clsx('i-lucide-light:plug', className)} />

  if (source?.startsWith(initialsIconPrefix)) {
    if (crossOrigin && fallback != null) return <>{fallback}</>
    return (
      <span data-icon-kind="initials" aria-hidden="true" className={clsx(styles.initials, className)}>
        <span>{source.slice(initialsIconPrefix.length)}</span>
      </span>
    )
  }

  if (!source) {
    return fallback as React.ReactElement
  }
  if (source === error && crossOrigin && fallback != null) return <>{fallback}</>
  if (source === error)
    return image == null ? (
      (fallback as React.ReactElement)
    ) : (
      <ContentIcon className={className} fallback={fallback} src={image.fallback} loading={loading} decoding={decoding} />
    )

  return result ? (
    <IconifyIcon collection={result.collection} icon={result.icon} color={result.color} className={className} onError={onError} />
  ) : (
    <img
      className={clsx(styles.img, className)}
      src={source}
      alt=""
      crossOrigin={crossOrigin}
      decoding={decoding}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={onError}
    />
  )
}

const initialsIconPrefix = 'data:application/vnd.open-flow.initials,'

export function initialsIcon(initials: string): string {
  return `${initialsIconPrefix}${initials}`
}

const imageIconPrefix = 'data:application/vnd.open-flow.image-icon+json,'

export function imageIcon(source: string, fallback: string, providerId?: string): string {
  return `${imageIconPrefix}${encodeURIComponent(JSON.stringify({ fallback, source, ...(providerId == null ? {} : { providerId }) }))}`
}

interface ImageDescriptor {
  readonly fallback: string
  readonly source: string
  readonly providerId?: string
}
type ProviderImageDescriptor = ImageDescriptor & { readonly providerId: string }
function parseImageIcon(src: string | undefined): ImageDescriptor | undefined {
  if (!src?.startsWith(imageIconPrefix)) return
  try {
    const value = JSON.parse(decodeURIComponent(src.slice(imageIconPrefix.length))) as {
      readonly fallback?: unknown
      readonly source?: unknown
      readonly providerId?: unknown
    }
    if (typeof value.fallback == 'string' && typeof value.source == 'string')
      return { fallback: value.fallback, source: value.source, ...(typeof value.providerId === 'string' ? { providerId: value.providerId } : {}) }
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
  const capture = useContext(IconImageCrossOriginContext) != null
  const { iconSprite: m, iconSpritePosition: p } = sprite
  const url = theme == 'dark' ? m.darkUrl : m.lightUrl
  const resource = useProviderIconResource({ kind: 'sprite', theme, url, version: m.version }, capture ? { x: p.x, y: p.y, size: m.iconSize } : undefined)
  if (resource.status == 'failed') return <ContentIcon {...props} src={sprite.fallback} />
  if (resource.status === 'loading') return <PendingIcon className={props.className} fallback={props.fallback} />
  if (capture)
    return (
      <img alt="" className={clsx(styles.img, props.className)} data-render-pending={resource.refreshing || undefined} src={resource.url} decoding="sync" />
    )
  return (
    <span aria-hidden="true" data-render-pending={resource.refreshing || undefined} className={clsx(styles.sprite, props.className)}>
      <span
        style={{
          backgroundImage: `url(${JSON.stringify(resource.url)})`,
          width: `${(m.width / m.iconSize) * 100}%`,
          height: `${(m.height / m.iconSize) * 100}%`,
          left: `${(-p.x / m.iconSize) * 100}%`,
          top: `${(-p.y / m.iconSize) * 100}%`,
        }}
      />
    </span>
  )
}

function ProviderImage({ image, ...props }: Omit<ContentIconProps, 'src'> & { image: ProviderImageDescriptor }) {
  const resource = useProviderIconResource({ kind: 'image', providerId: image.providerId, url: image.source })
  if (resource.status === 'failed') return <ContentIcon {...props} src={image.fallback} />
  if (resource.status === 'loading') return <PendingIcon className={props.className} fallback={props.fallback} />
  return (
    <img
      alt=""
      className={clsx(styles.img, props.className)}
      data-render-pending={resource.refreshing || undefined}
      src={resource.url}
      loading={props.loading}
      decoding={props.decoding}
    />
  )
}

function PendingIcon({ className, fallback }: Pick<ContentIconProps, 'className' | 'fallback'>) {
  return (
    <span aria-hidden="true" className={clsx(styles.pending, className)} data-render-pending>
      {fallback ?? <ContentIcon src={placeholderIcon} className={className} />}
    </span>
  )
}
