import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ConnectorAccess, ConnectorAccessCandidates, WorkbenchClient } from '../api.ts'
import type { Notice } from './workbenchNotice.ts'

import { val } from 'value-enhancer'
import { ApiError } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { errorNotice } from './workbenchNotice.ts'

interface ConnectorAccessState {
  readonly configuration?: { readonly providerId?: string }
  readonly access?: ConnectorAccess
  readonly candidateErrors: readonly string[]
  readonly candidates: Readonly<Record<string, ConnectorAccessCandidates | undefined>>
  readonly loading: boolean
  readonly loadingCandidates: readonly string[]
  readonly pendingSelection?: { readonly providerId: string; readonly accessBindingId: string; readonly selected: boolean }
  readonly savingProviderId?: string
}

const initialState: ConnectorAccessState = { candidates: {}, candidateErrors: [], loading: false, loadingCandidates: [] }

export class ConnectorAccessStore {
  readonly #state: Val<ConnectorAccessState> = val(initialState)
  #flowId?: string
  #generation = 0
  #disposed = false
  #candidatesController = new AbortController()

  readonly $: ReadonlyVal<ConnectorAccessState> = this.#state

  constructor(
    private readonly client: WorkbenchClient,
    private readonly setNotice: (notice: Notice) => void,
    private readonly i18n: I18n = createI18n(),
    private readonly onSaved: (flowId: string) => void = () => {},
  ) {}

  async load(flowId: string | undefined): Promise<void> {
    const refreshing = flowId != null && flowId == this.#flowId && this.#state.value.access != null
    const generation = ++this.#generation
    this.#flowId = flowId
    if (!refreshing) {
      this.#candidatesController.abort()
      this.#candidatesController = new AbortController()
      this.#state.set(flowId == null ? initialState : { ...initialState, loading: true })
    }
    if (flowId == null) return
    try {
      const access = await this.client.getConnectorAccess(flowId)
      if (!this.#disposed && generation == this.#generation) {
        const current = this.#state.value
        const latest = current.access != null && current.access.accessRevision > access.accessRevision ? current.access : access
        this.#state.set({ ...current, access: latest, loading: false })
      }
    } catch (error) {
      if (!this.#disposed && generation == this.#generation) {
        if (!refreshing) this.#state.set(initialState)
        this.setNotice(errorNotice(error, this.i18n.t))
      }
    }
  }

  changed(flowId: string): void {
    if (flowId == this.#flowId) void this.load(flowId)
  }

  configure(providerId?: string): void {
    if (this.#disposed || this.#flowId == null) return
    this.#state.set({ ...this.#state.value, configuration: providerId == null ? {} : { providerId } })
    if (providerId != null) void this.loadCandidates([providerId], true)
  }

  async loadCandidates(providerIds: readonly string[], force = false): Promise<void> {
    const flowId = this.#flowId
    const state = this.#state.value
    if (this.#disposed || flowId == null || state.access?.mode != 'selectable') return
    const requested = [...new Set(providerIds)].filter(
      (id) => !state.loadingCandidates.includes(id) && (force || (state.candidates[id] == null && !state.candidateErrors.includes(id))),
    )
    if (requested.length == 0) return
    const signal = this.#candidatesController.signal
    this.#state.set({
      ...state,
      candidateErrors: state.candidateErrors.filter((id) => !requested.includes(id)),
      loadingCandidates: [...state.loadingCandidates, ...requested],
    })
    try {
      const response = await this.client.listProviderAccessBindingCandidates(flowId, requested, signal)
      if (signal.aborted) return
      const current = this.#state.value
      const candidates = { ...current.candidates }
      const candidateErrors = [...current.candidateErrors]
      for (const result of response.results) {
        if ('error' in result) candidateErrors.push(result.providerId)
        else candidates[result.providerId] = result
      }
      this.#state.set({
        ...current,
        candidates,
        candidateErrors,
        loadingCandidates: current.loadingCandidates.filter((id) => !requested.includes(id)),
      })
      const failure = response.results.find((result) => 'error' in result)
      if (failure != null && 'error' in failure) this.setNotice(errorNotice(new ApiError(502, failure.error.code, failure.error.message), this.i18n.t))
    } catch (error) {
      if (signal.aborted) return
      const current = this.#state.value
      this.#state.set({
        ...current,
        candidateErrors: [...current.candidateErrors, ...requested],
        loadingCandidates: current.loadingCandidates.filter((id) => !requested.includes(id)),
      })
      this.setNotice(errorNotice(error, this.i18n.t))
    }
  }

  async select(providerId: string, accessBindingId: string, selected = true): Promise<boolean> {
    const flowId = this.#flowId
    const access = this.#state.value.access
    if (this.#disposed || flowId == null || access?.mode != 'selectable' || this.#state.value.savingProviderId != null) return false
    this.#state.set({ ...this.#state.value, savingProviderId: providerId, pendingSelection: { providerId, accessBindingId, selected } })
    try {
      const next = selected
        ? await this.client.addProviderAccessBinding(flowId, providerId, accessBindingId, access.accessRevision)
        : await this.client.removeProviderAccessBinding(flowId, providerId, accessBindingId, access.accessRevision)
      if (!this.#disposed && flowId == this.#flowId) {
        const current = this.#state.value.access
        this.#state.set({
          ...this.#state.value,
          access: current != null && current.accessRevision > next.accessRevision ? current : next,
          savingProviderId: undefined,
          pendingSelection: undefined,
        })
        this.onSaved(flowId)
        return true
      }
    } catch (error) {
      if (this.#disposed || flowId != this.#flowId) return false
      this.#state.set({ ...this.#state.value, savingProviderId: undefined, pendingSelection: undefined })
      this.setNotice(errorNotice(error, this.i18n.t))
      await this.load(flowId)
    }
    return false
  }

  async setService(providerId: string, selected: boolean): Promise<boolean> {
    const flowId = this.#flowId
    const access = this.#state.value.access
    if (this.#disposed || flowId == null || access?.mode != 'selectable' || this.#state.value.savingProviderId != null) return false
    this.#state.set({ ...this.#state.value, savingProviderId: providerId })
    try {
      const next = await this.client.setConnectorService(flowId, providerId, selected, access.accessRevision)
      if (this.#disposed || flowId != this.#flowId) return false
      this.#state.set({
        ...this.#state.value,
        access: next,
        savingProviderId: undefined,
        ...(!selected && this.#state.value.configuration?.providerId == providerId ? { configuration: {} } : {}),
      })
      this.onSaved(flowId)
      if (selected) this.configure(providerId)
      return true
    } catch (error) {
      if (this.#disposed || flowId != this.#flowId) return false
      this.#state.set({ ...this.#state.value, savingProviderId: undefined, pendingSelection: undefined })
      this.setNotice(errorNotice(error, this.i18n.t))
      await this.load(flowId)
      return false
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#candidatesController.abort()
    this.#generation += 1
    this.#state.dispose()
  }
}
