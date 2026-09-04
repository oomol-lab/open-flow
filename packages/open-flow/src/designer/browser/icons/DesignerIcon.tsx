import styles from './DesignerIcon.module.scss'

import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { IconifyIcon } from './IconifyIcon.tsx'

export interface DesignerIconProps {
  /** Can be an image URL or in the form of `":{collection}:{icon}:{color}:"`, like `":mdi:loading:red:"`. */
  src?: string
  /** Applied to the `<img>` element. */
  className?: string
  /** Fallback element if the `<img>` load failed. */
  fallback?: React.ReactNode
}

export const DesignerIcon = ({ src, className, fallback = null }: DesignerIconProps) => {
  const image = useMemo(() => parseImageIcon(src), [src])
  const source = image?.source ?? src
  const result = useMemo(() => parseIconifyIcon(source), [source])
  const [error, setError] = useState<string>()
  const onError = () => setError(source)

  if (!source) {
    return fallback as React.ReactElement
  }
  if (source === error)
    return image == null ? (fallback as React.ReactElement) : <DesignerIcon className={className} fallback={fallback} src={image.fallback} />

  return result ? (
    <IconifyIcon collection={result.collection} icon={result.icon} color={result.color} className={className} onError={onError} />
  ) : (
    <img className={clsx(styles.img, className)} src={source} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={onError} />
  )
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
