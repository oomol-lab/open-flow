import type { FlowQuery } from '../../../../control/common/api.ts'
import type { FlowCatalog } from '../stores/flowCatalog.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'

/** Each consumer owns a query page; editor identity and candidates keep their unfiltered catalog. */
export function useFlowQuery(store: WorkbenchStore, query: FlowQuery) {
  const [catalog, setCatalog] = useState<FlowCatalog>()
  const identity = JSON.stringify(query)
  const latestQuery = useRef(query)
  useEffect(() => {
    latestQuery.current = query
  })
  useEffect(() => {
    const next = store.createFlowCatalog()
    void next.setQuery(latestQuery.current)
    next.watch()
    setCatalog(next)
    return () => next.dispose()
  }, [store])
  useEffect(() => {
    if (catalog != null) void catalog.setQuery(latestQuery.current)
  }, [catalog, identity])
  return {
    catalog,
    flows: useVal(catalog?.$.flows) ?? [],
    total: useVal(catalog?.$.total),
    loading: useVal(catalog?.$.loading) ?? true,
    failed: useVal(catalog?.$.failed) ?? false,
    loadingMore: useVal(catalog?.$.loadingMore) ?? false,
    loadMoreFailed: useVal(catalog?.$.loadMoreFailed) ?? false,
    refreshing: useVal(catalog?.$.refreshing) ?? false,
    nextCursor: useVal(catalog?.$.nextCursor),
  }
}
