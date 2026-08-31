import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type {
  WorkbenchClient,
  Live,
  PollTriggerTestResult,
  Publication,
  PublishOperation,
  TriggerActivity,
  TriggerBinding,
  TriggerBindingDetail,
} from '../api.ts'
import type { WorkbenchPreferences } from '../contract.ts'
import type { SetNotice } from '../stores/workbenchNotice.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { derive, val } from 'value-enhancer'
import { ApiError } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { Latest } from '../stores/latest.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'

interface Target {
  readonly flowId: string
}

interface Attempt {
  readonly key: string
  readonly signature: string
}

interface PublicationState {
  readonly activities: readonly TriggerActivity[]
  readonly activitiesLoadFailed: boolean
  readonly activitiesLoading: boolean
  readonly activitiesLoadingMore: boolean
  readonly activitiesNextCursor?: string
  readonly bindings: readonly TriggerBinding[]
  readonly changingTriggerId?: string
  readonly detail?: TriggerBindingDetail
  readonly detailLoading: boolean
  readonly live?: Live
  readonly loadFailed: boolean
  readonly loading: boolean
  readonly loadMoreFailed: boolean
  readonly loadingMore: boolean
  readonly nextCursor?: string
  readonly operation?: PublishOperation
  readonly publications: readonly Publication[]
  readonly publishing: boolean
  readonly rollingBackPublicationId?: string
  readonly selectedTriggerId?: string
  readonly target?: Target
  readonly testingTriggerId?: string
  readonly testResult?: PollTriggerTestResult
  readonly total?: number
}

type Client = Pick<
  WorkbenchClient,
  | 'getFlowTriggerBinding'
  | 'getLive'
  | 'getPublishOperation'
  | 'listFlowTriggerActivities'
  | 'listFlowTriggerBindings'
  | 'listPublications'
  | 'pauseFlowTrigger'
  | 'publishFlow'
  | 'resumeFlowTrigger'
  | 'rollbackFlow'
  | 'testFlowPollTrigger'
>

export interface Publication$ {
  readonly activities: ReadonlyVal<readonly TriggerActivity[]>
  readonly activitiesLoadFailed: ReadonlyVal<boolean>
  readonly activitiesLoading: ReadonlyVal<boolean>
  readonly activitiesLoadingMore: ReadonlyVal<boolean>
  readonly activitiesNextCursor: ReadonlyVal<string | undefined>
  readonly bindings: ReadonlyVal<readonly TriggerBinding[]>
  readonly changingTriggerId: ReadonlyVal<string | undefined>
  readonly detail: ReadonlyVal<TriggerBindingDetail | undefined>
  readonly detailLoading: ReadonlyVal<boolean>
  readonly live: ReadonlyVal<Live | undefined>
  readonly loadFailed: ReadonlyVal<boolean>
  readonly loading: ReadonlyVal<boolean>
  readonly loadMoreFailed: ReadonlyVal<boolean>
  readonly loadingMore: ReadonlyVal<boolean>
  readonly nextCursor: ReadonlyVal<string | undefined>
  readonly operation: ReadonlyVal<PublishOperation | undefined>
  readonly publications: ReadonlyVal<readonly Publication[]>
  readonly publishing: ReadonlyVal<boolean>
  readonly rollingBackPublicationId: ReadonlyVal<string | undefined>
  readonly selectedTriggerId: ReadonlyVal<string | undefined>
  readonly testingTriggerId: ReadonlyVal<string | undefined>
  readonly testResult: ReadonlyVal<PollTriggerTestResult | undefined>
  readonly total: ReadonlyVal<number | undefined>
}

const initialState: PublicationState = {
  activities: [],
  activitiesLoadFailed: false,
  activitiesLoading: false,
  activitiesLoadingMore: false,
  bindings: [],
  detailLoading: false,
  loadFailed: false,
  loading: false,
  loadMoreFailed: false,
  loadingMore: false,
  publications: [],
  publishing: false,
}

const activityPageLimit = 20
const pageLimit = 50
const publishPollMs = 750

function sameTarget(left: Target | undefined, right: Target): boolean {
  return left?.flowId == right.flowId
}

export class PublicationStore {
  readonly #client: Client
  readonly #identity: () => string
  readonly #i18n: I18n
  readonly #loads = new Latest()
  readonly #operation = new Latest()
  readonly #preferences: WorkbenchPreferences
  readonly #triggerDetails = new Latest()
  readonly #triggerTest = new Latest()
  readonly #setNotice: SetNotice
  readonly #state: Val<PublicationState> = val(initialState)
  readonly #workspace: WorkspaceStore
  #attempt?: Attempt

  public readonly $: Publication$

  public constructor(
    client: Client,
    workspace: WorkspaceStore,
    setNotice: SetNotice,
    preferences: WorkbenchPreferences,
    identity: () => string = () => crypto.randomUUID(),
    i18n: I18n = createI18n(),
  ) {
    this.#client = client
    this.#identity = identity
    this.#i18n = i18n
    this.#preferences = preferences
    this.#setNotice = setNotice
    this.#workspace = workspace
    this.$ = {
      activities: derive(this.#state, (state) => state.activities),
      activitiesLoadFailed: derive(this.#state, (state) => state.activitiesLoadFailed),
      activitiesLoading: derive(this.#state, (state) => state.activitiesLoading),
      activitiesLoadingMore: derive(this.#state, (state) => state.activitiesLoadingMore),
      activitiesNextCursor: derive(this.#state, (state) => state.activitiesNextCursor),
      bindings: derive(this.#state, (state) => state.bindings),
      changingTriggerId: derive(this.#state, (state) => state.changingTriggerId),
      detail: derive(this.#state, (state) => state.detail),
      detailLoading: derive(this.#state, (state) => state.detailLoading),
      live: derive(this.#state, (state) => state.live),
      loadFailed: derive(this.#state, (state) => state.loadFailed),
      loading: derive(this.#state, (state) => state.loading),
      loadMoreFailed: derive(this.#state, (state) => state.loadMoreFailed),
      loadingMore: derive(this.#state, (state) => state.loadingMore),
      nextCursor: derive(this.#state, (state) => state.nextCursor),
      operation: derive(this.#state, (state) => state.operation),
      publications: derive(this.#state, (state) => state.publications),
      publishing: derive(this.#state, (state) => state.publishing),
      rollingBackPublicationId: derive(this.#state, (state) => state.rollingBackPublicationId),
      selectedTriggerId: derive(this.#state, (state) => state.selectedTriggerId),
      testingTriggerId: derive(this.#state, (state) => state.testingTriggerId),
      testResult: derive(this.#state, (state) => state.testResult),
      total: derive(this.#state, (state) => state.total),
    }
  }

  public dispose(): void {
    this.#loads.invalidate()
    this.#operation.invalidate()
    this.#triggerDetails.invalidate()
    this.#triggerTest.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.#state.dispose()
  }

  public reset(): void {
    this.#loads.invalidate()
    this.#operation.invalidate()
    this.#triggerDetails.invalidate()
    this.#triggerTest.invalidate()
    this.#attempt = undefined
    this.#state.set(initialState)
  }

  public async load(flowId: string): Promise<void> {
    const target = { flowId }
    const current = this.#loads.begin()
    if (!sameTarget(this.#state.value.target, target)) {
      this.#operation.invalidate()
      this.#attempt = undefined
    }
    this.#setNotice(undefined)
    this.#state.set({ ...initialState, loading: true, target })
    try {
      const operation = await this.#storedOperation(target)
      const [live, page, bindings] = await this.#read(target)
      if (!current()) return
      this.#set({
        bindings,
        live,
        loading: false,
        nextCursor: page.nextCursor,
        operation,
        publications: page.publications,
        publishing: operation?.status == 'pending',
        total: page.total,
      })
      if (operation?.status == 'pending') {
        const flow = this.#workspace.$.targetFlow.value
        void this.#observe(target, operation, this.#operation.begin(), flow?.flowId == target.flowId ? flow.name : target.flowId)
      }
    } catch (error) {
      if (!current()) return
      this.#set({ loadFailed: true, loading: false })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async loadMore(): Promise<void> {
    const { loadingMore, nextCursor, target } = this.#state.value
    if (loadingMore || nextCursor == null || target == null) return
    const current = this.#loads.capture()
    this.#set({ loadMoreFailed: false, loadingMore: true })
    try {
      const page = await this.#client.listPublications(target.flowId, { cursor: nextCursor, limit: pageLimit })
      if (!current()) return
      const seen = new Set(this.#state.value.publications.map((publication) => publication.publicationId))
      this.#set({
        loadingMore: false,
        loadMoreFailed: false,
        nextCursor: page.nextCursor,
        publications: [...this.#state.value.publications, ...page.publications.filter((publication) => !seen.has(publication.publicationId))],
      })
    } catch (error) {
      if (!current()) return
      this.#set({ loadMoreFailed: true, loadingMore: false })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async publish(): Promise<boolean> {
    const flow = this.#workspace.$.targetFlow.value
    const draft = this.#workspace.$.draft.value
    if (
      flow == null ||
      draft == null ||
      this.#state.value.changingTriggerId != null ||
      this.#state.value.publishing ||
      this.#state.value.rollingBackPublicationId != null
    ) {
      return false
    }
    const target = { flowId: flow.flowId }
    const expectedLivePublicationId = this.#workspace.$.live.value?.publication?.publicationId ?? null
    const signature = JSON.stringify({ expectedLivePublicationId, flowId: flow.flowId, kind: 'publish', revisionId: draft.revisionId })
    const attempt = this.#attempt?.signature == signature ? this.#attempt : { key: this.#identity(), signature }
    const current = this.#operation.begin()
    this.#attempt = attempt
    this.#setNotice(undefined)
    this.#setTarget(target, { publishing: true })
    try {
      const operation = await this.#client.publishFlow(flow.flowId, draft.revisionId, expectedLivePublicationId, { idempotencyKey: attempt.key })
      if (!current()) return false
      this.#preferences.setItem(this.#operationKey(target.flowId), operation.operationId)
      this.#set({ operation, publishing: operation.status == 'pending' })
      return await this.#observe(target, operation, current, flow.name)
    } catch (error) {
      if (!current()) return false
      if (error instanceof ApiError && error.code == 'live.conflict') await this.#recover(target)
      this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      if (current()) this.#set({ publishing: false })
    }
  }

  public async rollback(publication: Publication): Promise<boolean> {
    const { live, rollingBackPublicationId, target } = this.#state.value
    const currentPublicationId = live?.publication?.publicationId
    if (
      target == null ||
      currentPublicationId == null ||
      this.#state.value.changingTriggerId != null ||
      rollingBackPublicationId != null ||
      this.#state.value.publishing ||
      publication.flowId != target.flowId
    ) {
      return false
    }
    const signature = JSON.stringify({
      currentPublicationId,
      flowId: target.flowId,
      kind: 'rollback',
      targetPublicationId: publication.publicationId,
    })
    const attempt = this.#attempt?.signature == signature ? this.#attempt : { key: this.#identity(), signature }
    const current = this.#operation.begin()
    this.#attempt = attempt
    this.#setNotice(undefined)
    this.#set({ rollingBackPublicationId: publication.publicationId })
    try {
      await this.#client.rollbackFlow(target.flowId, publication.publicationId, currentPublicationId, { idempotencyKey: attempt.key })
      if (!current()) return false
      await this.#refresh(target)
      if (!current()) return false
      this.#attempt = undefined
      this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.rolledBack', { revision: publication.revisionId }) })
      return true
    } catch (error) {
      if (!current()) return false
      if (error instanceof ApiError && error.code == 'live.conflict') await this.#recover(target)
      this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      if (current()) this.#set({ rollingBackPublicationId: undefined })
    }
  }

  public closeTrigger(): void {
    this.#triggerDetails.invalidate()
    this.#triggerTest.invalidate()
    this.#set({
      activities: [],
      activitiesLoadFailed: false,
      activitiesLoading: false,
      activitiesLoadingMore: false,
      activitiesNextCursor: undefined,
      detail: undefined,
      detailLoading: false,
      selectedTriggerId: undefined,
      testingTriggerId: undefined,
      testResult: undefined,
    })
  }

  public async openTrigger(triggerId: string): Promise<void> {
    const target = this.#state.value.target
    if (target == null) return
    const current = this.#triggerDetails.begin()
    this.#triggerTest.invalidate()
    this.#set({
      activities: [],
      activitiesLoadFailed: false,
      activitiesLoading: true,
      activitiesLoadingMore: false,
      activitiesNextCursor: undefined,
      detail: undefined,
      detailLoading: true,
      selectedTriggerId: triggerId,
      testingTriggerId: undefined,
      testResult: undefined,
    })
    const [detail, activities] = await Promise.allSettled([
      this.#client.getFlowTriggerBinding(target.flowId, triggerId),
      this.#client.listFlowTriggerActivities(target.flowId, triggerId, { limit: activityPageLimit }),
    ])
    if (!current()) return
    if (detail.status == 'rejected') {
      this.#set({ activitiesLoading: false, detailLoading: false })
      this.#setNotice(errorNotice(detail.reason, this.#i18n.t))
      return
    }
    this.#set({ detail: detail.value, detailLoading: false })
    if (activities.status == 'fulfilled') {
      this.#set({
        activities: activities.value.activities,
        activitiesLoadFailed: false,
        activitiesLoading: false,
        activitiesNextCursor: activities.value.nextCursor,
      })
    } else {
      this.#set({ activitiesLoadFailed: true, activitiesLoading: false })
      this.#setNotice(errorNotice(activities.reason, this.#i18n.t))
    }
  }

  public async loadMoreTriggerActivities(): Promise<void> {
    const { activitiesLoadingMore, activitiesNextCursor, selectedTriggerId, target } = this.#state.value
    if (activitiesLoadingMore || activitiesNextCursor == null || selectedTriggerId == null || target == null) return
    const current = this.#triggerDetails.capture()
    this.#set({ activitiesLoadFailed: false, activitiesLoadingMore: true })
    try {
      const page = await this.#client.listFlowTriggerActivities(target.flowId, selectedTriggerId, {
        cursor: activitiesNextCursor,
        limit: activityPageLimit,
      })
      if (!current() || this.#state.value.selectedTriggerId != selectedTriggerId) return
      const seen = new Set(this.#state.value.activities.map((activity) => activity.activityId))
      this.#set({
        activities: [...this.#state.value.activities, ...page.activities.filter((activity) => !seen.has(activity.activityId))],
        activitiesLoadFailed: false,
        activitiesLoadingMore: false,
        activitiesNextCursor: page.nextCursor,
      })
    } catch (error) {
      if (!current() || this.#state.value.selectedTriggerId != selectedTriggerId) return
      this.#set({ activitiesLoadFailed: true, activitiesLoadingMore: false })
      this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async testTrigger(): Promise<boolean> {
    const { detail, selectedTriggerId, target, testingTriggerId } = this.#state.value
    if (
      detail?.binding.kind != 'poll' ||
      detail.binding.currentPublicationId == null ||
      selectedTriggerId == null ||
      target == null ||
      testingTriggerId != null
    ) {
      return false
    }
    const current = this.#triggerTest.begin()
    this.#set({ testingTriggerId: selectedTriggerId, testResult: undefined })
    try {
      const result = await this.#client.testFlowPollTrigger(target.flowId, selectedTriggerId)
      if (!current() || this.#state.value.selectedTriggerId != selectedTriggerId) return false
      this.#set({ testResult: result })
      return true
    } catch (error) {
      if (current() && this.#state.value.selectedTriggerId == selectedTriggerId) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      if (current() && this.#state.value.selectedTriggerId == selectedTriggerId) this.#set({ testingTriggerId: undefined })
    }
  }

  public async toggleTrigger(binding: TriggerBinding): Promise<boolean> {
    const target = this.#state.value.target
    if (target == null || this.#state.value.changingTriggerId != null || this.#state.value.publishing || this.#state.value.rollingBackPublicationId != null) {
      return false
    }
    const current = this.#operation.begin()
    this.#set({ changingTriggerId: binding.triggerNodeId })
    try {
      if (binding.operatorState == 'active') await this.#client.pauseFlowTrigger(target.flowId, binding.triggerNodeId)
      else await this.#client.resumeFlowTrigger(target.flowId, binding.triggerNodeId)
      if (!current()) return false
      const bindings = await this.#client.listFlowTriggerBindings(target.flowId)
      if (!current()) return false
      this.#set({ bindings })
      if (this.#state.value.selectedTriggerId == binding.triggerNodeId) void this.openTrigger(binding.triggerNodeId)
      this.#setNotice({
        kind: 'success',
        message: this.#i18n.t(binding.operatorState == 'active' ? 'notice.triggerPaused' : 'notice.triggerResumed'),
      })
      return true
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      if (current()) this.#set({ changingTriggerId: undefined })
    }
  }

  async #refresh(target: Target): Promise<void> {
    const [live, page, bindings] = await this.#read(target)
    this.#workspace.updateLive(live)
    await this.#workspace.refreshFlows()
    if (sameTarget(this.#state.value.target, target)) {
      this.#set({ bindings, live, loadFailed: false, nextCursor: page.nextCursor, publications: page.publications, total: page.total })
    }
  }

  async #recover(target: Target): Promise<void> {
    try {
      await this.#refresh(target)
      this.#attempt = undefined
    } catch {
      return
    }
  }

  async #read(target: Target) {
    return await Promise.all([
      this.#client.getLive(target.flowId),
      this.#client.listPublications(target.flowId, { includeTotal: true, limit: pageLimit }),
      this.#client.listFlowTriggerBindings(target.flowId),
    ])
  }

  async #storedOperation(target: Target): Promise<PublishOperation | undefined> {
    const operationId = this.#preferences.getItem(this.#operationKey(target.flowId))
    if (operationId == null || operationId == '') return
    try {
      return await this.#client.getPublishOperation(target.flowId, operationId)
    } catch (error) {
      if (error instanceof ApiError && error.code == 'publication.operation-not-found') {
        this.#preferences.setItem(this.#operationKey(target.flowId), '')
        return
      }
      throw error
    }
  }

  async #observe(target: Target, initial: PublishOperation, current: () => boolean, name: string): Promise<boolean> {
    let operation = initial
    while (operation.status == 'pending') {
      await new Promise((resolve) => setTimeout(resolve, publishPollMs))
      if (!current()) return false
      try {
        operation = await this.#client.getPublishOperation(target.flowId, operation.operationId)
      } catch (error) {
        if (!current()) return false
        if (error instanceof ApiError && error.code == 'publication.operation-not-found') {
          this.#preferences.setItem(this.#operationKey(target.flowId), '')
          this.#setTarget(target, { operation: undefined, publishing: false })
          this.#setNotice(errorNotice(error, this.#i18n.t))
          return false
        }
        this.#setNotice(errorNotice(error, this.#i18n.t))
        continue
      }
      if (!current()) return false
      this.#setTarget(target, { operation })
    }
    this.#attempt = undefined
    this.#setTarget(target, { operation, publishing: false })
    if (operation.status == 'failed') {
      this.#setNotice({ kind: 'error', message: operation.issue.message })
      return false
    }
    try {
      await this.#refresh(target)
    } catch (error) {
      if (current()) this.#setNotice(errorNotice(error, this.#i18n.t))
      return true
    }
    if (!current()) return false
    this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.published', { name }) })
    return true
  }

  #operationKey(flowId: string): string {
    return `publish-operation:${flowId}`
  }

  #setTarget(target: Target, patch: Partial<PublicationState>): void {
    if (sameTarget(this.#state.value.target, target)) this.#set(patch)
    else this.#state.set({ ...initialState, ...patch, target })
  }

  #set(patch: Partial<PublicationState>): void {
    this.#state.set({ ...this.#state.value, ...patch })
  }
}
