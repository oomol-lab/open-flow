import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { PrepareFlowResult } from '@oomol-lab/open-flow/flow-semantics'

import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'

/** Bounds retained Revision source, measured in UTF-16 code units. */
const maxCachedContentLength = 16 * 1024 * 1024

interface Entry {
  readonly revision: RevisionContent
  readonly prepared: Map<string, Promise<PrepareFlowResult>>
}

const encoder = new TextEncoder()
const entries = new Map<string, Entry>()
let cachedContentLength = 0

function deepFreeze<Value>(value: Value): Value {
  if (value == null || typeof value != 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  if (value instanceof Set) for (const item of value) deepFreeze(item)
  else for (const item of Object.values(value)) deepFreeze(item)
  return value
}

function entry(content: string): Entry {
  const cached = entries.get(content)
  if (cached != null) {
    entries.delete(content)
    entries.set(content, cached)
    return cached
  }
  const created = { revision: deepFreeze(decodeRevision(encoder.encode(content))), prepared: new Map() }
  if (content.length > maxCachedContentLength) return created
  entries.set(content, created)
  cachedContentLength += content.length
  for (const key of entries.keys()) {
    if (cachedContentLength <= maxCachedContentLength) break
    entries.delete(key)
    cachedContentLength -= key.length
  }
  return created
}

/**
 * Stored Revision content is immutable, so Run admission, workflow-call diagnostics, and execution share its decoding
 * and preparation. The content itself is the key; results are frozen because every caller observes the same value.
 */
export function decodedRevision(content: string): RevisionContent {
  return entry(content).revision
}

export function preparedRevision(content: string, engineContract: string, triggerId?: string): Promise<PrepareFlowResult> {
  const { prepared, revision } = entry(content)
  const key = JSON.stringify([engineContract, triggerId ?? null])
  let result = prepared.get(key)
  if (result == null) {
    result = prepareFlow(revision, engineContract, triggerId).then(deepFreeze)
    prepared.set(key, result)
    result.catch(() => {
      if (prepared.get(key) == result) prepared.delete(key)
    })
  }
  return result
}
