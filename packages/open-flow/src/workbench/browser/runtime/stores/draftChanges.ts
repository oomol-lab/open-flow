import type { I18n } from 'val-i18n'
import type { WorkbenchClient, Draft, FlowCheck } from '../api.ts'
import type { FlowChanges } from '../designer/flowChanges.ts'
import type { Current } from './latest.ts'
import type { SetNotice } from './workbenchNotice.ts'

import { FlowChangeError } from '../../../../flow/common/change.ts'
import { ApiError } from '../api.ts'
import { applyFlowChanges } from '../designer/flowChanges.ts'
import { errorNotice } from './workbenchNotice.ts'

export interface DraftChangeContext {
  readonly current: Current
  readonly flowId: string
}

interface PendingChange extends DraftChangeContext {
  active: boolean
  changeId: string
  changes: FlowChanges
  result?: Promise<Draft | undefined>
  started: boolean
}

type Hooks = {
  readonly apply: (draft: Draft, preserveDiagnostics?: boolean) => void
  readonly beforeChange: (manageBusy: boolean) => void
  readonly check: () => void
  readonly current: (context: DraftChangeContext) => boolean
  readonly diagnostics: () => FlowCheck | undefined
  readonly finishChanges: () => void
  readonly headChanged: (flowId: string, revisionId: string) => void
  readonly recover: (context: DraftChangeContext) => Promise<boolean>
}

function mergeChanges(before: FlowChanges, after: FlowChanges): FlowChanges | undefined {
  if (before.length != 1 || after.length != 1) return
  const first = before[0]
  const last = after[0]
  if (first?.kind == 'graph.node.field.set' && last?.kind == 'graph.node.field.set') {
    if (first.nodeId != last.nodeId || first.field != last.field || first.target.kind != last.target.kind) return
    if (first.target.kind == 'subflow' && (last.target.kind != 'subflow' || first.target.id != last.target.id)) return
    return [{ before: first.before, field: last.field, kind: last.kind, nodeId: last.nodeId, target: last.target, value: last.value }]
  }
  if (first?.kind == 'graph.node.input.set' && last?.kind == 'graph.node.input.set') {
    if (first.nodeId != last.nodeId || first.handle != last.handle || first.target.kind != last.target.kind) return
    if (first.target.kind == 'subflow' && (last.target.kind != 'subflow' || first.target.id != last.target.id)) return
    return [{ before: first.before, handle: last.handle, kind: last.kind, nodeId: last.nodeId, target: last.target, value: last.value }]
  }
}

export class DraftChanges {
  readonly #client: WorkbenchClient
  readonly #hooks: Hooks
  readonly #i18n: I18n
  readonly #setNotice: SetNotice
  #changes = 0
  #committed?: Draft
  #pending: PendingChange[] = []
  #queue: Promise<void> = Promise.resolve()

  public constructor(client: WorkbenchClient, setNotice: SetNotice, i18n: I18n, hooks: Hooks) {
    this.#client = client
    this.#setNotice = setNotice
    this.#i18n = i18n
    this.#hooks = hooks
  }

  public get committed(): Draft | undefined {
    return this.#committed
  }

  public get changing(): boolean {
    return this.#changes > 0
  }

  public get pendingCount(): number {
    return this.#pending.length
  }

  public reset(draft?: Draft): void {
    this.#committed = draft
    this.#pending = []
    this.#queue = Promise.resolve()
  }

  public replaceCommitted(draft: Draft): Draft {
    this.#committed = draft
    let projected = draft
    const pending: PendingChange[] = []
    for (const change of this.#pending) {
      try {
        projected = applyFlowChanges(projected, change.changes)
        pending.push(change)
      } catch (error) {
        if (!(error instanceof FlowChangeError)) throw error
        change.active = false
      }
    }
    this.#pending = pending
    return projected
  }

  public project(draft: Draft): Draft {
    return this.#pending.reduce((current, pending) => applyFlowChanges(current, pending.changes), draft)
  }

  public enqueue(task: () => Promise<void>): Promise<void> {
    const queued = this.#queue.then(task)
    this.#queue = queued
    return queued
  }

  public async change(context: DraftChangeContext, draft: Draft, changes: FlowChanges, manageBusy = true): Promise<Draft | undefined> {
    const tail = this.#pending.at(-1)
    const merged = tail == null || tail.started || !tail.active ? undefined : mergeChanges(tail.changes, changes)
    if (tail != null && merged != null) {
      tail.changes = merged
      if (this.#committed != null) this.#hooks.apply(this.project(this.#committed))
      return tail.result
    }
    this.#hooks.beforeChange(manageBusy)
    const pending: PendingChange = { ...context, active: true, changeId: crypto.randomUUID(), changes, started: false }
    this.#committed ??= draft
    this.#pending.push(pending)
    this.#hooks.apply(this.project(this.#committed))
    this.#changes += 1
    const change = this.#queue.then(() => {
      pending.started = true
      return this.#commit(pending)
    })
    pending.result = change
    this.#queue = change.then(() => undefined)
    try {
      return await change
    } finally {
      this.#changes -= 1
      if (this.#changes == 0) this.#hooks.finishChanges()
    }
  }

  async #commit(pending: PendingChange): Promise<Draft | undefined> {
    let recovered = false
    while (pending.active && this.#hooks.current(pending)) {
      const base = this.#committed
      if (base == null) return
      try {
        const changed = await this.#client.changeDraft(pending.flowId, base.revisionId, pending.changes, pending.changeId)
        if (!this.#hooks.current(pending)) return
        if (changed.revision.parentRevisionId != base.revisionId) throw new Error('Invalid Draft change response.')
        const committed = this.#applyCommitted(pending, base, changed)
        if (this.#pending.length == 0) this.#hooks.check()
        return committed
      } catch (error) {
        if (error instanceof ApiError && error.code == 'flow.revision-conflict') {
          if (!recovered && (await this.#hooks.recover(pending))) {
            recovered = true
            pending.changeId = crypto.randomUUID()
            continue
          }
          if (recovered) await this.#hooks.recover(pending)
          this.#reject(pending)
        } else {
          if (!(error instanceof ApiError) && !recovered) {
            const revisionId = this.#committed?.revisionId
            if (await this.#hooks.recover(pending)) {
              recovered = true
              if (pending.active && this.#committed?.revisionId != revisionId) pending.changeId = crypto.randomUUID()
              continue
            }
          }
          this.#reject(pending)
          if (this.#hooks.current(pending)) this.#setNotice(errorNotice(error, this.#i18n.t))
        }
        return
      }
    }
  }

  #applyCommitted(pending: PendingChange, base: Draft, change: Awaited<ReturnType<WorkbenchClient['changeDraft']>>): Draft {
    const committed = { ...change.revision, content: applyFlowChanges(base, pending.changes).content }
    this.#pending = this.#pending.filter((candidate) => candidate !== pending)
    this.#committed = committed
    const diagnostics = this.#hooks.diagnostics()
    const preserveDiagnostics = this.#pending.length == 0 && diagnostics?.revisionId == committed.revisionId
    this.#hooks.apply(this.project(committed), preserveDiagnostics)
    this.#hooks.headChanged(pending.flowId, committed.revisionId)
    return committed
  }

  #reject(pending: PendingChange): void {
    pending.active = false
    this.#pending = this.#pending.filter((candidate) => candidate !== pending)
    if (!this.#hooks.current(pending) || this.#committed == null) return
    this.#hooks.apply(this.project(this.#committed))
  }
}
