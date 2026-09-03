import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { WorkbenchClient, Flow } from '../api.ts'
import type { Current } from './latest.ts'
import type { SetNotice } from './workbenchNotice.ts'

import { derive, val } from 'value-enhancer'
import { Latest } from './latest.ts'
import { errorNotice } from './workbenchNotice.ts'

const pageLimit = 50

interface State {
  readonly failed: boolean
  readonly loaded: boolean
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly loadMoreFailed: boolean
  readonly refreshing: boolean
  readonly nextCursor?: string
  readonly flows: readonly Flow[]
  readonly total?: number
}

export interface FlowCatalog$ {
  readonly failed: ReadonlyVal<boolean>
  readonly loading: ReadonlyVal<boolean>
  readonly loadingMore: ReadonlyVal<boolean>
  readonly loadMoreFailed: ReadonlyVal<boolean>
  readonly refreshing: ReadonlyVal<boolean>
  readonly nextCursor: ReadonlyVal<string | undefined>
  readonly flows: ReadonlyVal<readonly Flow[]>
  readonly total: ReadonlyVal<number | undefined>
}

const initialState: State = {
  failed: false,
  loaded: false,
  loading: true,
  loadingMore: false,
  loadMoreFailed: false,
  refreshing: false,
  flows: [],
}

export class FlowCatalog {
  readonly #client: WorkbenchClient
  readonly #i18n: I18n
  readonly #session = new Latest()
  readonly #setNotice: SetNotice
  readonly #state: Val<State> = val(initialState)
  #disposed = false
  public readonly $: FlowCatalog$

  public constructor(client: WorkbenchClient, setNotice: SetNotice, i18n: I18n) {
    this.#client = client
    this.#i18n = i18n
    this.#setNotice = setNotice
    this.$ = {
      failed: derive(this.#state, (state) => state.failed),
      loading: derive(this.#state, (state) => state.loading),
      loadingMore: derive(this.#state, (state) => state.loadingMore),
      loadMoreFailed: derive(this.#state, (state) => state.loadMoreFailed),
      refreshing: derive(this.#state, (state) => state.refreshing),
      nextCursor: derive(this.#state, (state) => state.nextCursor),
      flows: derive(this.#state, (state) => state.flows),
      total: derive(this.#state, (state) => state.total),
    }
  }

  public get loaded(): boolean {
    return this.#state.value.loaded
  }

  public dispose(): void {
    this.#disposed = true
    this.#session.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.#state.dispose()
  }

  public capture(): Current {
    return this.#session.capture()
  }

  public flow(flowId: string): Flow | undefined {
    return this.#state.value.flows.find((flow) => flow.flowId == flowId)
  }

  public async reload(): Promise<void> {
    const current = this.#session.begin()
    const loaded = this.#state.value.loaded
    if (loaded) {
      this.#set({ failed: false, loadingMore: false, loadMoreFailed: false, refreshing: true })
    } else {
      this.#set({
        failed: false,
        loading: true,
        loadingMore: false,
        loadMoreFailed: false,
        refreshing: false,
        nextCursor: undefined,
        flows: [],
        total: undefined,
      })
    }
    try {
      const page = await this.#client.listFlows({ includeTotal: true, limit: pageLimit })
      if (!current()) return
      this.#set({
        loaded: true,
        loading: false,
        refreshing: false,
        nextCursor: page.nextCursor,
        flows: page.flows,
        total: page.total,
      })
    } catch (error) {
      if (!current()) return
      this.#set({ failed: !loaded, loading: false, refreshing: false })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async loadMore(): Promise<void> {
    const { loadingMore, nextCursor, refreshing } = this.#state.value
    if (loadingMore || refreshing || nextCursor == null) return
    const current = this.#session.capture()
    this.#set({ loadingMore: true, loadMoreFailed: false })
    try {
      const page = await this.#client.listFlows({ cursor: nextCursor, limit: pageLimit })
      if (!current()) return
      const seen = new Set(this.#state.value.flows.map((flow) => flow.flowId))
      this.#set({
        loadingMore: false,
        nextCursor: page.nextCursor,
        flows: [...this.#state.value.flows, ...page.flows.filter((flow) => !seen.has(flow.flowId))],
      })
    } catch (error) {
      if (!current()) return
      this.#set({ loadingMore: false, loadMoreFailed: true })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async create(name: string): Promise<Flow | undefined> {
    const flow = await this.#client.createFlow(name)
    if (this.#disposed) return
    this.#set({
      flows: [...this.#state.value.flows, flow],
      total: this.#state.value.total == null ? undefined : this.#state.value.total + 1,
    })
    return flow
  }

  public include(flow: Flow): void {
    const index = this.#state.value.flows.findIndex((candidate) => candidate.flowId == flow.flowId)
    if (index < 0) {
      this.#set({ flows: [...this.#state.value.flows, flow] })
      return
    }
    this.#set({ flows: this.#state.value.flows.with(index, flow) })
  }

  public insert(flow: Flow): void {
    if (this.#state.value.flows.some((candidate) => candidate.flowId == flow.flowId)) return
    this.#set({
      flows: [...this.#state.value.flows, flow],
      total: this.#state.value.total == null ? undefined : this.#state.value.total + 1,
    })
  }

  public remove(flowId: string): void {
    this.#set({
      flows: this.#state.value.flows.filter((flow) => flow.flowId != flowId),
      total: this.#state.value.total == null ? undefined : this.#state.value.total - 1,
    })
  }

  public advanceHead(flowId: string, revisionId: string): void {
    this.#set({
      flows: this.#state.value.flows.map((flow) => (flow.flowId == flowId ? { ...flow, draftRevisionId: revisionId } : flow)),
    })
  }

  #set(patch: Partial<State>): void {
    if (!this.#disposed) this.#state.set({ ...this.#state.value, ...patch })
  }
}
