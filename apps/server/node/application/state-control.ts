import type { StateRead } from '@oomol-lab/open-flow/flow-state'
import type { StateStore } from '../storage/state-store.ts'
import type { ControlAccess } from './control-access.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import {
  StateError,
  stateClearSchema,
  stateQuerySchema,
  stateSummaryQuerySchema,
  dedupeClearSchema,
  dedupeClearAllSchema,
} from '@oomol-lab/open-flow/flow-state'
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
    return this.store.view(flowId, parsed.data.scope)
  }

  readValues(actorId: string, flowId: string, input: StateRead) {
    this.access.authorize(actorId, { flowId })
    try {
      return { version: 1 as const, scope: input.scope, values: this.store.readValues(flowId, input.scope, input.keys) }
    } catch (error) {
      if (error instanceof StateError && error.code === 'limit-exceeded') throw new ControlError(controlErrorCode.flowInvalid, error.message)
      throw error
    }
  }

  summary(actorId: string, flowId: string, query: unknown) {
    this.access.authorize(actorId, { flowId })
    const parsed = stateSummaryQuerySchema.safeParse(query)
    if (!parsed.success) throw new ControlError(controlErrorCode.flowInvalid, parsed.error.message)
    return this.store.summary(flowId, parsed.data.scope)
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
    if (!this.store.clearSpace(flowId, parsed.data.scope, parsed.data.space))
      throw new ControlError(controlErrorCode.flowConflict, 'This history has pending Run records. Finish or cancel those Runs before clearing it.')
    return { version: 1 as const, cleared: true as const }
  }

  clearAllDedupe(actorId: string, flowId: string, query: unknown) {
    this.access.authorize(actorId, { flowId })
    const parsed = dedupeClearAllSchema.safeParse(query)
    if (!parsed.success) throw new ControlError(controlErrorCode.flowInvalid, parsed.error.message)
    if (!this.store.clearAvailableSpaces(flowId, parsed.data.scope))
      throw new ControlError(controlErrorCode.flowConflict, 'All history sources have pending Run records. Finish or cancel those Runs before clearing them.')
    return { version: 1 as const, cleared: true as const }
  }
}
