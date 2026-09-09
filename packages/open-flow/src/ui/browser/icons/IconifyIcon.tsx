import styles from './IconifyIcon.module.scss'
import type { IconifyJSON, IconifyIcon as RawIcon } from '@iconify/types'
import type { GeneralIconifyData, IconifyDataKey } from './iconifyContext.tsx'

import { encodeSvgForCss } from '@iconify/utils'
import { clsx } from 'clsx'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import MANUALLY_ADDED_ICONS from './extra-icon.json'
import { iconifyData, useIconifyCollectionLoader, useIconifyData } from './iconifyContext.tsx'

export const ICONIFY_COLOR_DARK = /*#__PURE__*/ encodeURIComponent('#ffffffd9')
export const ICONIFY_COLOR_LIGHT = /*#__PURE__*/ encodeURIComponent('#5d6066')

export interface IconifyIconProps {
  collection: string
  icon: string
  color?: string
  className?: string
  onError?: (error: Error) => void
}

function isBundledCollection(collection: string): collection is IconifyDataKey {
  return collection == 'carbon' || collection == 'twemoji'
}

/** Must be rendered under an IconifyProvider. */
export const IconifyIcon = ({ collection, icon, color, className, onError }: IconifyIconProps) => {
  const contextData = useIconifyData(true)
  const loadCollection = useIconifyCollectionLoader()
  const bundledCollection = isBundledCollection(collection) ? collection : undefined
  const bundledCollectionPending = bundledCollection != null && !contextData?.[bundledCollection]

  useEffect(() => {
    if (bundledCollectionPending && bundledCollection) {
      void loadCollection?.(bundledCollection).catch((error) => onError?.(error))
    }
  }, [bundledCollection, bundledCollectionPending, loadCollection, onError])

  const url = useMemo<string | undefined>(() => getInlineIconifyIcon(collection, icon, void 0, contextData), [contextData, collection, icon])
  return url ? (
    <IconifyIconSync url={url} collection={collection} icon={icon} color={color} className={className} />
  ) : bundledCollectionPending ? (
    <i />
  ) : (
    <IconifyIconAsync collection={collection} icon={icon} color={color} className={className} onError={onError} />
  )
}

// This component fetches icons directly from the Iconify API.
const IconifyIconAsync = ({ collection, icon, color, className, onError }: IconifyIconProps) => {
  const [url, setURL] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    let isUnmounted = false
    fetchIcon(collection, icon)
      .then((rawIcon) => {
        if (isUnmounted) return
        setURL(generateSvgDataUri(rawIcon.width, rawIcon.height, rawIcon))
      })
      .catch((error) => {
        if (isUnmounted) return
        setURL(undefined)
        onError?.(error)
      })
    return () => {
      isUnmounted = true
    }
  }, [collection, icon])

  if (url) {
    return <i className={clsx(className, styles.icon, !url.includes('currentColor') && 'is-colored')} style={{ color, '--icon': `url("${url}")` } as any} />
  }

  // Keep the loading placeholder inert to avoid duplicate API requests.
  return <i />
}

// Reuse the URL object between requests.
const fetchIconUrl = new URL('https://api.iconify.design/codicon.json?icons=close')
export const fetchIcon = async (collection: string, icon: string): Promise<RawIcon> => {
  fetchIconUrl.pathname = `/${collection}.json`
  fetchIconUrl.searchParams.set('icons', icon)
  const res = await fetch(fetchIconUrl.href)
  if (!res.ok) throw new Error(`Failed to fetch ${collection}:${icon}: ${res.statusText}. Status: ${res.status}`)
  const json: IconifyJSON | 404 = await res.json()
  if (typeof json === 'number') {
    throw new Error(`Failed to fetch ${collection}:${icon}: ${res.statusText}. Status: ${json}`)
  }
  const rawIcon = json.icons[icon]
  if (rawIcon) {
    const width = rawIcon.width || json.width
    const height = rawIcon.height || json.height
    if (!rawIcon.width) rawIcon.width = width
    if (!rawIcon.height) rawIcon.height = height
  }
  return rawIcon
}

// The caller provides loaded Iconify data before rendering this component.
const IconifyIconSync = ({ url, color, className }: IconifyIconProps & { url: string }) => {
  return <i className={clsx(className, styles.icon, !url.includes('currentColor') && 'is-colored')} style={{ color, '--icon': `url("${url}")` } as any} />
}

/**
 * If the icon was loaded, returns a string like `data:image/svg+xml;utf8,...` for the icon.
 * You can use CSS `color: ...` to set the color of the icon.
 *
 * Load the collection through `IconifyProvider` before calling this function, or pass collection
 * data explicitly. React components can use the `useIconifyData()` hook.
 */
export const getInlineIconifyIcon = (collection: string, icon: string, color?: string, data?: GeneralIconifyData | null): string | undefined => {
  data ||= iconifyData
  let rawIcon: RawIcon | undefined, json: IconifyJSON | undefined
  if (data) {
    const pkg = data[collection]
    if (pkg) {
      json = pkg.icons
      rawIcon = json.icons[icon]
    }
  }
  if (!json) {
    json = (MANUALLY_ADDED_ICONS as any)[collection]
    rawIcon = json && json.icons[icon]
  }
  if (rawIcon && json) {
    return generateSvgDataUri(rawIcon.width || json.width, rawIcon.height || json.height, rawIcon, color)
  }
}

function generateSvgDataUri(width: number | undefined, height: number | undefined, rawIcon: RawIcon, color?: string) {
  width = width || 16
  height = height || 16
  const viewBox = `0 0 ${width} ${height}`
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1em" height="1em">${rawIcon.body}</svg>`
  if (color) {
    svg = svg.replace(/currentColor/g, color)
  }
  return `data:image/svg+xml;utf8,${encodeSvgForCss(svg)}`
}

export const getExternalIconifyIcon = (collection: string, icon: string, color?: string): { '--icon-light': string; '--icon-dark': string } => {
  const externalURL = `https://api.iconify.design/${collection}:${icon}.svg?color=`

  return !color || color === 'currentColor'
    ? {
        '--icon-dark': `url(${externalURL}${ICONIFY_COLOR_DARK})`,
        '--icon-light': `url(${externalURL}${ICONIFY_COLOR_LIGHT})`,
      }
    : {
        '--icon-dark': `url(${externalURL}${encodeURIComponent(color)})`,
        '--icon-light': `url(${externalURL}${encodeURIComponent(color)})`,
      }
}
