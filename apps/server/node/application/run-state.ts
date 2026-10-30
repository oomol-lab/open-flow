import type { RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { StoredRun } from '../storage/run-store.ts'
import type { StateStore } from '../storage/state-store.ts'

import { dedupeIdentities, hashIdentities, stateKey, StateError } from '@oomol-lab/open-flow/flow-state'
import { snapshotRuntimeResult } from '@oomol-lab/open-flow/runtime-contract'

export class RunState {
  readonly store: StateStore
  constructor(store: StateStore) {
    this.store = store
  }

  async invoke(run: StoredRun, call: RuntimeCapabilityCall): Promise<RuntimeCapabilityResponse> {
    if (call.nodeId == null || call.jobId == null || !call.invocationId || run.source == null)
      throw new StateError('capability.denied', 'State requires a Code Task invocation.')
    const scope = run.source
    const active = () => {
      call.signal.throwIfAborted()
      if (
        this.store.database
          .prepare("SELECT 1 FROM runs WHERE run_id = ? AND flow_id = ? AND source = ? AND status = 'running'")
          .get(run.runId, run.flowId, scope) == null
      )
        throw new StateError('capability.denied', 'State requires an active Run.')
    }
    active()
    const payload = call.payload
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) throw new StateError('capability.invalid', 'Invalid State request.')
    const fields = payload as Record<string, unknown>
    const write = () => this.store.reserveWrite(run.flowId, scope, run.runId)
    switch (call.kind) {
      case 'state.get':
        return { status: 200, body: { value: this.store.get(run.flowId, scope, stateKey(fields.key)) } }
      case 'state.list':
        return { status: 200, body: { keys: this.store.list(run.flowId, scope) } }
      case 'state.delete': {
        const key = stateKey(fields.key)
        write()
        this.store.set(run.flowId, scope, run.runId, key, null)
        return { status: 200, body: null }
      }
      case 'state.set':
      case 'state.insert': {
        const key = stateKey(fields.key)
        if (fields.value === undefined || (call.kind === 'state.insert' && fields.value === null))
          throw new StateError('capability.invalid', 'Invalid State value.')
        let value
        try {
          value = snapshotRuntimeResult({ value: fields.value }) as { value: import('@oomol-lab/open-flow/flow-change').JsonValue }
        } catch {
          throw new StateError('capability.invalid', 'State values must be JSON.')
        }
        write()
        const inserted = this.store.set(run.flowId, scope, run.runId, key, value.value, call.kind === 'state.insert')
        return { status: 200, body: call.kind === 'state.insert' ? { inserted } : null }
      }
      case 'dedupe.insert':
      case 'dedupe.has': {
        const ids = dedupeIdentities(fields.ids)
        const hashes = await hashIdentities(ids)
        active()
        if (call.kind === 'dedupe.has') return { status: 200, body: { present: this.store.has(run.flowId, scope, 'flow', hashes) } }
        write()
        return { status: 200, body: { inserted: this.store.insert(run.flowId, scope, 'flow', 'new', ids, hashes) } }
      }
      default:
        throw new StateError('capability.denied', 'Unknown State capability.')
    }
  }
}
