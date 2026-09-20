import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ConnectorAccess, ConnectorAccessCandidates, WorkbenchClient } from '../api.ts'
import type { Notice } from './workbenchNotice.ts'

import { val } from 'value-enhancer'
import { createI18n } from '../i18n.ts'
import { errorNotice } from './workbenchNotice.ts'

interface ConnectorAccessState {
  readonly access?: ConnectorAccess
  readonly candidateErrors: readonly string[]
  readonly candidates: Readonly<Record<string, ConnectorAccessCandidates | undefined>>
  readonly loading: boolean
  readonly loadingCandidates: readonly string[]
  readonly savingProviderId?: string
}

const initialState: ConnectorAccessState = { candidates: {}, candidateErrors: [], loading: false, loadingCandidates: [] }

export class ConnectorAccessStore {
  readonly #state: Val<ConnectorAccessState> = val(initialState)
  #flowId?: string
  #generation = 0
  #disposed = false

  readonly $: ReadonlyVal<ConnectorAccessState> = this.#state

  constructor(
    private readonly client: WorkbenchClient,
    private readonly setNotice: (notice: Notice) => void,
    private readonly i18n: I18n = createI18n(),
  ) {}

  async load(flowId: string | undefined): Promise<void> {
    const refreshing = flowId != null && flowId == this.#flowId && this.#state.value.access != null
    const generation = ++this.#generation
    this.#flowId = flowId
    if (!refreshing) this.#state.set(flowId == null ? initialState : { ...initialState, loading: true })
    if (flowId == null) return
    try {
      const access = await this.client.getConnectorAccess(flowId)
      if (!this.#disposed && generation == this.#generation) {
        const current = this.#state.value
        const latest = current.access != null && current.access.accessRevision > access.accessRevision ? current.access : access
        this.#state.set(refreshing ? { ...current, access: latest } : { ...initialState, access: latest })
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

  async loadCandidates(providerId: string): Promise<void> {
    const flowId = this.#flowId
    const state = this.#state.value
    if (flowId == null || state.access?.mode != 'selectable' || state.loadingCandidates.includes(providerId)) return
    this.#state.set({
      ...state,
      candidateErrors: state.candidateErrors.filter((id) => id != providerId),
      loadingCandidates: [...state.loadingCandidates, providerId],
    })
    try {
      const candidates = await this.client.listProviderAccessBindingCandidates(flowId, providerId)
      if (this.#disposed || flowId != this.#flowId) return
      const current = this.#state.value
      this.#state.set({
        ...current,
        candidates: { ...current.candidates, [providerId]: candidates },
        loadingCandidates: current.loadingCandidates.filter((id) => id != providerId),
      })
    } catch (error) {
      if (this.#disposed || flowId != this.#flowId) return
      const current = this.#state.value
      this.#state.set({
        ...current,
        candidateErrors: [...current.candidateErrors.filter((id) => id != providerId), providerId],
        loadingCandidates: current.loadingCandidates.filter((id) => id != providerId),
      })
      this.setNotice(errorNotice(error, this.i18n.t))
    }
  }

  async select(providerId: string, accessBindingId: string, selected = true): Promise<boolean> {
    const flowId = this.#flowId
    const access = this.#state.value.access
    if (flowId == null || access?.mode != 'selectable' || this.#state.value.savingProviderId != null) return false
    this.#state.set({ ...this.#state.value, savingProviderId: providerId })
    try {
      const next = selected
        ? await this.client.addProviderAccessBinding(flowId, providerId, accessBindingId, access.accessRevision)
        : await this.client.removeProviderAccessBinding(flowId, providerId, accessBindingId, access.accessRevision)
      if (!this.#disposed && flowId == this.#flowId) {
        this.#state.set({ ...this.#state.value, access: next, savingProviderId: undefined })
        return true
      }
    } catch (error) {
      if (this.#disposed || flowId != this.#flowId) return false
      this.#state.set({ ...this.#state.value, savingProviderId: undefined })
      this.setNotice(errorNotice(error, this.i18n.t))
      await this.load(flowId)
    }
    return false
  }

  dispose(): void {
    this.#disposed = true
    this.#generation += 1
    this.#state.dispose()
  }
}
