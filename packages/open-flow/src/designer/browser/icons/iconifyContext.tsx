import type { IconifyJSONPackageExports } from '@iconify/types'
import type { FC, ReactNode } from 'react'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type IconifyDataKey = 'carbon' | 'twemoji'

export interface IconifyData extends GeneralIconifyData {
  readonly carbon?: IconifyJSONPackageExports
  readonly twemoji?: IconifyJSONPackageExports
}

export interface GeneralIconifyData {
  readonly [collection: string]: IconifyJSONPackageExports | undefined
}

interface IconifyContextValue {
  readonly data: IconifyData | null
  loadCollection(collection: IconifyDataKey): Promise<void>
}

export interface IconifyProviderProps {
  readonly children?: ReactNode
}

export let iconifyData: IconifyData | null = null

const collectionLoads: Map<IconifyDataKey, Promise<IconifyJSONPackageExports>> = new Map()

function loadCollectionData(collection: IconifyDataKey): Promise<IconifyJSONPackageExports> {
  let pending = collectionLoads.get(collection)
  if (!pending) {
    const importCollection = collection == 'carbon' ? import('@iconify-json/carbon') : import('virtual:open-flow-twemoji').then((module) => module.default)
    pending = importCollection.catch((error: unknown) => {
      collectionLoads.delete(collection)
      throw error
    })
    collectionLoads.set(collection, pending)
  }
  return pending
}

const IconifyContext = createContext<IconifyContextValue | null>(null)

export const IconifyProvider: FC<IconifyProviderProps> = ({ children }) => {
  const [data, setData] = useState<IconifyData | null>(iconifyData)
  const mountedRef = useRef(true)

  const loadCollection = useCallback(async (collection: IconifyDataKey): Promise<void> => {
    if (iconifyData?.[collection]) {
      if (mountedRef.current) setData(iconifyData)
      return
    }

    const collectionData = await loadCollectionData(collection)
    iconifyData = { ...iconifyData, [collection]: collectionData }
    if (mountedRef.current) setData(iconifyData)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const value = useMemo<IconifyContextValue>(() => ({ data, loadCollection }), [data, loadCollection])
  return <IconifyContext.Provider value={value}>{children}</IconifyContext.Provider>
}

export function useIconifyData(general: true): GeneralIconifyData | null
export function useIconifyData(): IconifyData | null
export function useIconifyData(): IconifyData | null {
  return useContext(IconifyContext)?.data ?? null
}

export function useIconifyCollectionLoader(): IconifyContextValue['loadCollection'] | undefined {
  return useContext(IconifyContext)?.loadCollection
}
