import styles from './ContentIcon.module.scss'

import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { IconifyIcon } from './IconifyIcon.tsx'

export interface ContentIconProps {
  /** Can be an image URL or in the form of `":{collection}:{icon}:{color}:"`, like `":mdi:loading:red:"`. */
  src?: string
  /** Applied to the `<img>` element. */
  className?: string
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  /** Fallback element if the `<img>` load failed. */
  fallback?: React.ReactNode
}

export const ContentIcon = ({ src, className, fallback = null, loading = 'lazy', decoding = 'async' }: ContentIconProps) => {
  const image = useMemo(() => parseImageIcon(src), [src])
  const source = image?.source ?? src
  const result = useMemo(() => parseIconifyIcon(source), [source])
  const [error, setError] = useState<string>()
  const onError = () => setError(source)

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
