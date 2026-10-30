import type { StateStore } from '../storage/state-store.ts'
import type { ControlAccess } from './control-access.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { stateClearSchema, stateQuerySchema, dedupeClearSchema } from '@oomol-lab/open-flow/flow-state'
import { ControlError } from '../error.ts'

export class StateControl {
  readonly access: ControlAccess
  readonly store: StateStore
  constructor(access: ControlAccess, store: StateStore) {
    this.access = access
    this.store = store
  }

  read(actorId: string, flowId: string, query: unknown) {
    this.access.authorize(actorId, { flowId })
    const parsed = stateQuerySchema.safeParse(query)
    if (!parsed.success) throw new ControlError(controlErrorCode.flowInvalid, parsed.error.message)
    return this.store.view(flowId, parsed.data.scope, parsed.data.values)
  }

  clear(actorId: string, flowId: string, query: unknown) {
    this.access.authorize(actorId, { flowId })
    const parsed = stateClearSchema.safeParse(query)
    if (!parsed.success) throw new ControlError(controlErrorCode.flowInvalid, parsed.error.message)
    this.store.clearValues(flowId, parsed.data.scope, parsed.data.key)
    return { version: 1 as const, cleared: true as const }
  }

  clearDedupe(actorId: string, flowId: string, query: unknown) {
    this.access.authorize(actorId, { flowId })
    const parsed = dedupeClearSchema.safeParse(query)
    if (!parsed.success) throw new ControlError(controlErrorCode.flowInvalid, parsed.error.message)
    this.store.clearSpace(flowId, parsed.data.scope, parsed.data.space)
    return { version: 1 as const, cleared: true as const }
  }
}
