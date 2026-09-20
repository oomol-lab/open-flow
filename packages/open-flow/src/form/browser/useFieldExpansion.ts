import type { FieldExpansionInput, FieldExpansionPolicy } from '../common/fieldExpansion.ts'

import { useState } from 'react'
import { valueFieldExpansion } from '../common/fieldExpansion.ts'

/** Initial policy and explicit actions are the only writers; value updates never reopen a field. */
export function useFieldExpansion(input: FieldExpansionInput, policy: FieldExpansionPolicy = valueFieldExpansion) {
  const [state, setState] = useState(() => {
    const initial = policy(input)
    return { expanded: initial === true, mounted: initial === true, pending: initial === undefined }
  })
  let current = state
  if (state.pending) {
    const decision = policy(input)
    if (decision !== undefined) {
      current = { expanded: decision, mounted: state.mounted || decision, pending: false }
      setState(current)
    }
  }
  const setExpanded = (expanded: boolean) => setState((previous) => ({ expanded, mounted: previous.mounted || expanded, pending: false }))
  return { expanded: current.expanded, bodyMounted: current.mounted, setExpanded }
}
