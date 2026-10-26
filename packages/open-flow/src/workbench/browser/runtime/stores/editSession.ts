import type { I18n } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { WorkbenchClient, Draft, Presentation } from '../api.ts'
import type { FlowChanges } from '../editor/flowChanges.ts'
import type { PropertyDeletion } from '../editor/propertyDeletion.ts'
import type { RevisionView } from '../revisionView.ts'
import type { CanvasAction, CanvasHistoryEntry } from './canvasHistory.ts'
import type { DraftChangeContext } from './draftChanges.ts'
import type { PresentationUpdate } from './presentationChanges.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { ModuleEditorDraft, WorkspaceState } from './workspaceModel.ts'

import { dequal } from 'dequal/lite'
import { inverseFlowChanges } from '../../../../flow/common/inverseChanges.ts'
import { repairNodeNames } from '../../../../flow/common/nodeChanges.ts'
import { canvasPresentationChange, restoreCanvasPresentation } from '../canvasPresentation.ts'
import { applyFlowChanges } from '../editor/flowChanges.ts'
import { revisionView } from '../revisionView.ts'
import { CanvasHistory } from './canvasHistory.ts'
import { DraftChanges } from './draftChanges.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { Latest } from './latest.ts'
import { ModuleEditorSession } from './moduleEditorSession.ts'
import { PresentationChanges } from './presentationChanges.ts'
import { errorNotice } from './workbenchNotice.ts'
import { moduleEditorStatus, selectedModuleEditor, WorkspaceModel } from './workspaceModel.ts'

const deletionMessageKeys = {
  field: 'history.deleted.field',
  group: 'history.deleted.group',
  objectItem: 'history.deleted.objectItem',
  arrayItem: 'history.deleted.arrayItem',
  option: 'history.deleted.option',
  case: 'history.deleted.case',
  condition: 'history.deleted.condition',
  conditionGroup: 'history.deleted.conditionGroup',
  webhookBody: 'history.deleted.webhookBody',
} as const satisfies Readonly<Record<PropertyDeletion['target'], string>>

interface ReconciledRevision {
  readonly revision: RevisionView
  readonly selectedNodeIds: readonly string[]
}

export class EditSession {
  readonly #client: WorkbenchClient
  readonly #draftChanges: DraftChanges
  readonly #draftSession = new Latest()
  readonly #i18n: I18n
  readonly #presentationChanges: PresentationChanges
  readonly #flows: FlowCatalog
  readonly #setNotice: SetNotice
  readonly #model: WorkspaceModel
  readonly #modules: ModuleEditorSession
  readonly #history = new CanvasHistory()
  public readonly history$: ReadonlyVal<CanvasHistory['state$']['value']> = this.#history.state$
  #historyRecovery?: Promise<void>
  #draftInvalidation = 0
  #draftUpdateNotice = false
  #disposed = false
  #draftSyncQueued = false

  constructor(client: WorkbenchClient, model: WorkspaceModel, flows: FlowCatalog, setNotice: SetNotice, i18n: I18n) {
    this.#client = client
    this.#model = model
    this.#flows = flows
    this.#setNotice = setNotice
    this.#i18n = i18n
    this.#modules = new ModuleEditorSession(this.#model, this.#draftSession, (changes) => this.#saveModuleSource(changes), setNotice, i18n)
    this.#draftChanges = new DraftChanges(client, setNotice, i18n, {
      apply: (draft) => this.#applyDraft(draft, 'local'),
      beforeChange: (manageBusy) => {
        if (manageBusy) {
          this.set({ busy: 'designer' })
        }
      },
      check: () => void this.checkDraft(),
      current: (context) => this.#isDraftChangeCurrent(context),
      finishChanges: () => {
        if (!this.#disposed && this.#model.value.busy == 'designer') this.set({ busy: undefined })
      },
      headChanged: (flowId, revisionId, content) => this.#flows.advanceHead(flowId, revisionId, content),
      recover: (context) => {
        void this.retryHistorySync()
        return this.#syncDraftHead(context, true)
      },
    })
    this.#presentationChanges = new PresentationChanges(client, setNotice, (presentation) => this.set({ presentation }), i18n)
  }

  public selectNodes(nodeIds: readonly string[]): boolean {
    if (nodeIds.length == this.#model.value.selectedNodeIds.length && nodeIds.every((nodeId, index) => nodeId == this.#model.value.selectedNodeIds[index]))
      return true
    void this.#modules.flush()
    this.set({
      diagnosticFocus: undefined,
      moduleEditor: selectedModuleEditor(this.#model.value.draft == null ? undefined : revisionView(this.#model.value.draft), nodeIds),
      nodeFocus: undefined,
      selectedNodeIds: nodeIds,
    })
    return true
  }

  public updateModuleSource(source: string): void {
    const editor = this.#model.value.moduleEditor
    if (this.#history.applying || this.#history.failed || editor == null || editor.source == source) return
    this.#history.discardRedo()
    this.#modules.updateModuleSource(source)
  }

  public discardModuleChanges(): void {
    this.#modules.discardModuleChanges()
  }

  public get hasUnsavedCode(): boolean {
    return this.#modules.hasUnsavedCode
  }

  public async saveDraft(): Promise<boolean> {
    const current = this.#draftSession.capture()
    const saved = await Promise.all([this.#draftChanges.flush(), this.saveModuleEditor()])
    if (saved.some((success) => !success) || !current()) return false
    return (await this.#draftChanges.flush()) && current() && !this.#disposed && !this.#history.failed
  }

  public saveModuleEditor(): Promise<boolean> {
    return this.#modules.saveModuleEditor()
  }

  #notifyDeletion(deletion: PropertyDeletion, entry: CanvasHistoryEntry): void {
    this.#setNotice({
      kind: 'success',
      message:
        'name' in deletion ? this.#i18n.t(deletionMessageKeys[deletion.target], { name: deletion.name }) : this.#i18n.t(deletionMessageKeys[deletion.target]),
      undo: {
        label: this.#i18n.t('history.undo'),
        run: async () => {
          if (this.history$.value.undo !== entry) return
          await this.undo()
        },
      },
    })
  }

  async #changeDraft(changes: FlowChanges, manageBusy = true, historyMode: 'clear' | 'canvas' | 'code' = 'clear'): Promise<Draft | undefined> {
    if (this.#disposed || ((this.#history.applying || this.#history.failed) && historyMode != 'canvas')) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) return
    if (changes.length == 0 || dequal(applyFlowChanges(draft, changes).content, draft.content)) return draft
    const cleared = historyMode == 'clear' && this.#history.clear()
    const current = this.#draftSession.capture()
    this.#history.beginChange()
    try {
      const saved = this.#draftChanges.change({ current, flowId }, draft, changes, manageBusy)
      if (cleared) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.cleared') })
      const result = await saved
      if (result == null && current()) void this.retryHistorySync()
      return result
    } finally {
      this.#history.endChange()
    }
  }

  async #saveModuleSource(changes: FlowChanges): Promise<Draft | undefined> {
    const saved = await this.#changeDraft(changes, false, 'code')
    if (saved != null) {
      for (const operation of changes) {
        if (operation.kind != 'module.source.replace') continue
        const module = saved.content.modules[operation.moduleId]
        if (module != null) this.#history.rebaseModuleCreation(operation.moduleId, module)
      }
    }
    return saved
  }

  async repairDraftNodeNames(current: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 2 && current(); attempt += 1) {
      const draft = this.#model.value.draft
      if (draft == null) return
      const repairs = repairNodeNames(draft.content, { start: this.#i18n.t('addNode.start') })
      if (repairs.length == 0) {
        void this.checkDraft()
        return
      }
      const changed = await this.#changeDraft(repairs, false)
      if (changed != null || !current()) return
      if (this.#model.value.draft?.revisionId == draft.revisionId) break
    }
    if (current()) void this.checkDraft()
  }

  #applyDraft(draft: Draft, origin: 'local' | 'external'): boolean {
    const previousDraft = this.#model.value.draft
    const { revision, selectedNodeIds } = this.#reconcileRevision(draft)
    const editor = this.#model.value.moduleEditor
    const keepEditor = editor != null && (origin == 'external' || previousDraft != null) && moduleEditorStatus(previousDraft, editor) != 'saved'
    let moduleEditor: ModuleEditorDraft | undefined
    if (keepEditor) moduleEditor = origin == 'external' ? { ...editor, phase: 'failed' } : editor
    else moduleEditor = selectedModuleEditor(revision, selectedNodeIds)
    this.set({
      // Keep the last check until its replacement arrives; pending is not error-free.
      draft,
      moduleEditor,
      selectedNodeIds,
    })
    return keepEditor
  }

  async changePresentation(update: PresentationUpdate, historyOwned = false): Promise<boolean> {
    if (this.#disposed || ((this.#history.applying || this.#history.failed) && !historyOwned)) return false
    const flowId = this.#model.value.flowId
    const presentation = this.#model.value.presentation
    if (flowId == null || presentation == null) return false
    if (dequal(update(presentation.value), presentation.value)) return true
    if (!historyOwned) this.#clearHistoryForEdit()
    const current = this.#draftSession.capture()
    this.#history.beginChange()
    try {
      const result = await this.#presentationChanges.change(flowId, presentation, current, update)
      if (!result && current()) void this.retryHistorySync()
      return result
    } finally {
      this.#history.endChange()
    }
  }

  #clearHistoryForEdit(): void {
    if (this.#history.clear()) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.cleared') })
  }

  async canvasChange(
    action: CanvasAction,
    count: number,
    changes: FlowChanges,
    update?: PresentationUpdate,
    selection = this.#model.value.selectedNodeIds,
    deletion?: PropertyDeletion,
  ): Promise<boolean> {
    if (this.#disposed || this.#history.applying || this.#history.failed) return false
    const { draft, presentation, selectedNodeIds } = this.#model.value
    if (draft == null || presentation == null) return false
    const next = update?.(presentation.value) ?? presentation.value
    const presentationChange = canvasPresentationChange(presentation.value, next)
    if (dequal(applyFlowChanges(draft, changes).content, draft.content) && presentationChange.nodeIds.length == 0) return true
    const generation = this.#history.generation
    const inverse = inverseFlowChanges(draft.content, changes)
    this.#history.beginChange()
    const entry: CanvasHistoryEntry = {
      action,
      count,
      forward: changes,
      inverse,
      presentation: presentationChange,
      beforeSelection: selectedNodeIds,
      afterSelection: selection,
    }
    const retained = this.#history.record(entry)
    try {
      const change = changes.length == 0 ? Promise.resolve(draft) : this.#changeDraft(changes, true, 'canvas')
      const layout = update == null ? Promise.resolve(true) : this.changePresentation(update, true)
      this.selectNodes(selection)
      if (!retained) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.tooLarge') })
      const [saved, positioned] = await Promise.all([change, layout])
      const complete = saved != null && positioned && (!retained || generation == this.#history.generation)
      if (complete && retained && deletion != null && this.history$.value.undo === entry) this.#notifyDeletion(deletion, entry)
      return complete
    } catch (error) {
      this.#setNotice(errorNotice(error, this.#i18n.t))
      void this.retryHistorySync()
      return false
    } finally {
      this.#history.endChange()
    }
  }

  public async undo(): Promise<void> {
    await this.#restoreHistory(false)
  }

  public async redo(): Promise<void> {
    await this.#restoreHistory(true)
  }

  async #restoreHistory(redo: boolean): Promise<void> {
    if (this.hasUnsavedCode && !(await this.saveModuleEditor())) return
    const state = this.history$.value
    if (!(redo ? state.canRedo : state.canUndo)) return
    const entry = redo ? state.redo : state.undo
    if (entry == null) return
    const generation = this.#history.generation
    this.#history.beginRestore()
    try {
      const [draft, presentation] = await Promise.all([
        this.#changeDraft(redo ? entry.forward : entry.inverse, true, 'canvas'),
        this.changePresentation((value) => restoreCanvasPresentation(value, entry.presentation, redo), true),
      ])
      if (draft != null && presentation && generation == this.#history.generation) {
        this.selectNodes(redo ? entry.afterSelection : entry.beforeSelection)
        this.#history.complete(redo)
      }
    } catch (error) {
      this.#setNotice(errorNotice(error, this.#i18n.t))
      void this.retryHistorySync()
    } finally {
      this.#history.endRestore()
    }
  }

  public async retryHistorySync(): Promise<void> {
    if (this.#disposed || this.#historyRecovery != null) return this.#historyRecovery
    const flowId = this.#model.value.flowId
    if (flowId == null) return
    const current = this.#draftSession.capture()
    this.#history.beginRecovery()
    const recovery = async () => {
      await Promise.allSettled([this.#draftChanges.settled(), this.#presentationChanges.settled()])
      if (!current() || this.#disposed) return
      try {
        const { draft, presentation } = await this.#client.getEditor(flowId)
        if (!current() || this.#disposed) return
        this.#draftChanges.reset(draft)
        this.#presentationChanges.reset(presentation)
        this.#applyDraft(draft, 'external')
        this.set({ presentation })
        this.#flows.advanceHead(flowId, draft.revisionId, draft.content)
        this.#history.endRecovery()
        this.#setNotice({ kind: 'error', message: this.#i18n.t('history.resynced') })
        void this.checkDraft()
      } catch {
        if (current() && !this.#disposed) this.#setNotice({ kind: 'error', message: this.#i18n.t('history.syncFailed') })
      }
    }
    this.#historyRecovery = recovery().finally(() => {
      this.#historyRecovery = undefined
    })
    return this.#historyRecovery
  }

  async checkDraft(): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) {
      if (this.#model.value.draft == null) this.set({ checkLoading: false, diagnostics: undefined })
      return
    }
    this.set({ checkLoading: true, diagnosticFocus: undefined })
    try {
      const diagnostics = await this.#client.checkFlow(flowId, draft.revisionId)
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) {
        const live = this.#model.value.live
        this.set({
          diagnostics,
          live:
            live == null
              ? undefined
              : {
                  ...live,
                  hasUnpublishedChanges: live.publication == null || live.publication.closureDigest != diagnostics.closureDigest,
                },
        })
      }
    } catch (error) {
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) {
        this.#setNotice(errorNotice(error, this.#i18n.t))
      }
    } finally {
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) this.set({ checkLoading: false })
    }
  }

  async refreshDraft(revisionId?: string): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    if (flowId == null) return
    this.#draftInvalidation += 1
    if (revisionId != null) {
      this.#draftUpdateNotice = true
    }
    if (this.#draftSyncQueued) return
    this.#draftSyncQueued = true
    const context = { current: this.#draftSession.capture(), flowId }
    await this.#draftChanges.enqueue(async () => {
      let generation: number
      do {
        generation = this.#draftInvalidation
        const notifyUpdate = this.#draftUpdateNotice
        this.#draftUpdateNotice = false
        await this.#syncDraftHead(context, false, notifyUpdate)
      } while (this.#isDraftChangeCurrent(context) && generation != this.#draftInvalidation)
    })
    if (this.#isDraftChangeCurrent(context)) this.#draftSyncQueued = false
  }

  async #syncDraftHead(context: DraftChangeContext, reportError: boolean, notifyUpdate = false): Promise<boolean> {
    try {
      const base = this.#draftChanges.committed
      if (base == null) return false

      const synced = await this.#client.syncDraft(context.flowId)
      if (!this.#isDraftChangeCurrent(context)) return false
      const committed = synced.draft
      if (committed.revisionId == base.revisionId) return true

      if (this.#history.clear()) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.external') })
      const draft = this.#draftChanges.replaceCommitted(committed)
      const preserveModuleEditor = this.#applyDraft(draft, 'external')
      this.#flows.advanceHead(context.flowId, committed.revisionId, committed.content)
      if (notifyUpdate) {
        this.#setNotice({
          kind: preserveModuleEditor ? 'error' : 'success',
          message: this.#i18n.t(preserveModuleEditor ? 'notice.moduleUpdated' : 'notice.draftUpdated'),
        })
      }
      void this.checkDraft()
      return true
    } catch (error) {
      if (reportError && this.#isDraftChangeCurrent(context)) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  #reconcileRevision(draft: Draft): ReconciledRevision {
    const revision = revisionView(draft)
    const selectedNodeIds = this.#model.value.selectedNodeIds.filter((nodeId) => revision.selection(nodeId) != null)
    return { revision, selectedNodeIds }
  }

  #isDraftChangeCurrent(context: DraftChangeContext): boolean {
    return !this.#disposed && context.flowId == this.#model.value.flowId && context.current()
  }

  set(patch: Partial<WorkspaceState>): void {
    if (this.#disposed) return
    const editor = Object.hasOwn(patch, 'moduleEditor') ? patch.moduleEditor : this.#model.value.moduleEditor
    this.#model.set({ ...patch, ...this.#modules.state(editor) })
  }

  get applying(): boolean {
    return this.#history.applying
  }
  get committed(): Draft | undefined {
    return this.#draftChanges.committed
  }

  begin() {
    this.#history.reset()
    const current = this.#draftSession.begin()
    this.#draftChanges.reset()
    this.#presentationChanges.reset()
    this.#draftInvalidation = 0
    this.#draftUpdateNotice = false
    this.#draftSyncQueued = false
    return current
  }

  capture() {
    return this.#draftSession.capture()
  }

  reset(draft: Draft, presentation: Presentation): void {
    this.#draftChanges.reset(draft)
    this.#presentationChanges.reset(presentation)
  }

  async finishNodeCreation(nodeId: string, changes: FlowChanges): Promise<void> {
    if (this.#history.completeNodeCreation(nodeId, changes)) await this.#changeDraft(changes, false, 'canvas')
  }

  async loadTriggerConfigOptions(triggerId: string, field: string, signal: AbortSignal) {
    const flowId = this.#model.value.flowId
    const current = this.#draftSession.capture()
    await this.#draftChanges.settled()
    signal.throwIfAborted()
    if (this.#disposed || !current() || flowId == null) throw new DOMException('Draft changed', 'AbortError')
    return await this.#client.listTriggerConfigOptions(flowId, triggerId, field, signal)
  }

  async flush(): Promise<boolean> {
    const current = this.#draftSession.capture()
    return (await this.saveDraft()) && (await this.#presentationChanges.flush()) && current()
  }

  dispose(): void {
    this.#disposed = true
    this.#modules.dispose()
    this.#draftSession.invalidate()
    this.#presentationChanges.dispose()
    this.#history.dispose()
  }
}
