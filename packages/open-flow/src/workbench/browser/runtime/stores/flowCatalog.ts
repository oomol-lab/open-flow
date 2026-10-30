import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { FlowQuery, FlowUpdate } from '../../../../control/common/api.ts'
import type { RevisionContent } from '../../../../flow/common/change.ts'
import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'
import type { WorkbenchClient, Flow } from '../api.ts'
import type { SetNotice } from './workbenchNotice.ts'

import * as Effect from 'effect/Effect'
import { derive, val } from 'value-enhancer'
import { normalizeFlowQuery } from '../../../../control/common/api.ts'
import { flowResourceReferences } from '../../../../flow/common/semantics.ts'
import { Latest } from './latest.ts'
import { errorNotice } from './workbenchNotice.ts'

const pageLimit = 50

export type FlowCatalogItem = Flow & { readonly referenceCount?: number }

interface State {
  readonly failed: boolean
  readonly loaded: boolean
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly loadMoreFailed: boolean
  readonly refreshing: boolean
  readonly nextCursor?: string
  readonly flows: readonly FlowCatalogItem[]
  readonly total?: number
}

export interface FlowCatalog$ {
  readonly failed: ReadonlyVal<boolean>
  readonly loading: ReadonlyVal<boolean>
  readonly loadingMore: ReadonlyVal<boolean>
  readonly loadMoreFailed: ReadonlyVal<boolean>
  readonly refreshing: ReadonlyVal<boolean>
  readonly nextCursor: ReadonlyVal<string | undefined>
  readonly flows: ReadonlyVal<readonly FlowCatalogItem[]>
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
  readonly #lifetime = new AbortController()
  readonly #pending = new Set<string>()
  #disposed = false
  #query: Required<FlowQuery> = normalizeFlowQuery()
  #request?: AbortController
  #stopWatch?: () => void
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
    if (this.#disposed) return
    this.#disposed = true
    this.#request?.abort()
    this.#stopWatch?.()
    this.#lifetime.abort()
    this.#session.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.#state.dispose()
  }

  public flow(flowId: string): Flow | undefined {
    return this.#state.value.flows.find((flow) => flow.flowId == flowId)
  }

  public watch(): void {
    if (this.#stopWatch != null) return
    const subscription = this.#client.watchFlowCatalog(() => void this.reload())
    this.#stopWatch = subscription.stop
    void subscription.ready.then(() => {
      if (!this.#disposed) void this.reload()
    })
  }

  public async setQuery(query: FlowQuery): Promise<void> {
    const next = normalizeFlowQuery(query)
    if (JSON.stringify(next) == JSON.stringify(this.#query) && (this.loaded || this.#request != null)) return
    this.#query = next
    this.#state.set({ ...initialState })
    await this.reload()
  }

  public async reload(): Promise<void> {
    if (this.#disposed) return
    this.#request?.abort()
    const controller = (this.#request = new AbortController())
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
      })
    }
    try {
      const page = await this.#client.listFlows({ ...this.#query, includeTotal: true, limit: pageLimit, signal: controller.signal })
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
      const page = await this.#client.listFlows({ ...this.#query, cursor: nextCursor, limit: pageLimit, signal: this.#request?.signal })
      if (!current()) return
      const flows = new Map(this.#state.value.flows.map((flow) => [flow.flowId, flow]))
      for (const flow of page.flows) flows.set(flow.flowId, flow)
      this.#set({
        loadingMore: false,
        nextCursor: page.nextCursor,
        flows: [...flows.values()],
      })
    } catch (error) {
      if (!current()) return
      this.#set({ loadingMore: false, loadMoreFailed: true })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async setEnabled(flow: Flow, enabled: boolean): Promise<void> {
    if (flow.live == null || this.#pending.has(flow.flowId)) return
    this.#pending.add(flow.flowId)
    try {
      const changed = await this.#client.setFlowEnabled(flow.flowId, flow.live.publicationId, enabled)
      if (!this.#disposed) this.include(changed)
    } catch (error) {
      if (!this.#disposed) {
        this.#setNotice(errorNotice(error, this.#i18n.t))
        await this.reload()
      }
    } finally {
      this.#pending.delete(flow.flowId)
    }
  }

  public async publish(flow: Flow): Promise<void> {
    if (this.#pending.has(flow.flowId)) return
    this.#pending.add(flow.flowId)
    try {
      const initial = await this.#client.publishFlow(flow.flowId, flow.draftRevisionId, flow.live?.publicationId ?? null)
      if (this.#disposed) return
      const operation = await Effect.runPromise(
        Effect.gen({ self: this }, function* () {
          let current = initial
          while (current.status == 'pending') {
            yield* Effect.sleep(1000)
            current = yield* Effect.tryPromise((signal) => this.#client.getPublishOperation(flow.flowId, current.operationId, signal))
          }
          return current
        }),
        { signal: this.#lifetime.signal },
      )
      if (this.#disposed) return
      if (operation.status == 'failed') {
        this.#setNotice({ kind: 'error', message: operation.issue.message })
      } else {
        this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.published', { name: flow.name }) })
      }
      this.include(await this.#client.getFlow(flow.flowId))
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    } finally {
      this.#pending.delete(flow.flowId)
    }
  }

  public create(
    name: string,
    create?: (name: string, options?: { readonly tagIds?: readonly string[] }) => Promise<string>,
    tagIds?: readonly string[],
  ): Promise<Flow | undefined> {
    return this.#create(async () =>
      create == null
        ? tagIds == null
          ? this.#client.createFlow(name)
          : this.#client.createFlow(name, undefined, undefined, tagIds)
        : this.#client.getFlow(await (tagIds == null ? create(name) : create(name, { tagIds }))),
    )
  }

  public import(
    file: WorkflowFile,
    name: string,
    key: string,
    importer?: (file: WorkflowFile, name: string, key: string, options?: { readonly tagIds?: readonly string[] }) => Promise<string>,
    tagIds?: readonly string[],
  ): Promise<Flow | undefined> {
    return this.#create(async () =>
      importer == null
        ? this.#client.importFlow(file, { name, idempotencyKey: key, ...(tagIds == null ? {} : { tagIds }) })
        : this.#client.getFlow(await (tagIds == null ? importer(file, name, key) : importer(file, name, key, { tagIds }))),
    )
  }

  async #create(create: () => Promise<Flow>): Promise<Flow | undefined> {
    try {
      const created = await create()
      if (this.#disposed) return
      this.#insert(created)
      return created
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async delete(flow: Flow): Promise<boolean> {
    if (flow.status == 'retiring') return false
    try {
      await this.#client.deleteFlow(flow.flowId)
      if (this.#disposed) return false
      this.#remove(flow.flowId)
      this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.flowDeleteAccepted', { name: flow.name }) })
      return true
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  public async updateSettings(flowId: string, changes: FlowUpdate): Promise<boolean> {
    try {
      const changed = await this.#client.updateFlow(flowId, changes)
      if (this.#disposed) return false
      this.include(changed)
      return true
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  public async rename(flow: Flow, name: string): Promise<boolean> {
    const nextName = name.trim()
    if (nextName.length == 0) return false
    if (flow.name == nextName) return true
    try {
      const changed = await this.#client.renameFlow(flow.flowId, nextName)
      if (this.#disposed) return false
      this.include(changed)
      this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.flowRenamed', { name: nextName }) })
      return true
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  public include(flow: Flow): void {
    const index = this.#state.value.flows.findIndex((candidate) => candidate.flowId == flow.flowId)
    if (index < 0) {
      this.#set({ flows: [...this.#state.value.flows, flow] })
      return
    }
    const referenceCount = this.#state.value.flows[index]!.referenceCount
    this.#set({ flows: this.#state.value.flows.with(index, { ...flow, ...(referenceCount == null ? {} : { referenceCount }) }) })
  }

  #insert(flow: Flow): void {
    if (this.#state.value.flows.some((candidate) => candidate.flowId == flow.flowId)) return
    this.#set({
      flows: [...this.#state.value.flows, flow],
      total: this.#state.value.total == null ? undefined : this.#state.value.total + 1,
    })
  }

  #remove(flowId: string): void {
    this.#set({
      flows: this.#state.value.flows.filter((flow) => flow.flowId != flowId),
      total: this.#state.value.total == null ? undefined : this.#state.value.total - 1,
    })
  }

  public advanceHead(flowId: string, revisionId: string, content: RevisionContent): void {
    this.#set({
      flows: this.#state.value.flows.map((flow) =>
        flow.flowId == flowId
          ? {
              ...flow,
              draftRevisionId: revisionId,
              resourceReferences: { ...flow.resourceReferences, draft: flowResourceReferences(content) },
            }
          : flow,
      ),
    })
  }

  #set(patch: Partial<State>): void {
    if (!this.#disposed) this.#state.set({ ...this.#state.value, ...patch })
  }
}
