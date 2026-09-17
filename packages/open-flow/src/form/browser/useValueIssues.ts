import type { ValueIssues } from '../common/validation/valueIssues.ts'

import { useEffect, useMemo, useRef, useState } from 'react'
import { valueIssues } from '../common/validation/valueIssues.ts'

export function useValueIssues(schema: unknown, value: unknown, language: string, enabled: boolean) {
  const request = useMemo(() => ({ schema, value, language, enabled }), [schema, value, language, enabled])
  const current = useRef(request)
  current.current = request
  const [completed, setCompleted] = useState<{ request: typeof request; result: ValueIssues }>()
  useEffect(() => {
    if (!request.enabled) return
    const controller = new AbortController()
    void valueIssues(request.schema, request.value, request.language, controller.signal).then((result) => {
      if (result && !controller.signal.aborted && current.current === request) setCompleted({ request, result })
    })
    return () => controller.abort()
  }, [request])
  return completed?.request === request ? completed.result : undefined
}
