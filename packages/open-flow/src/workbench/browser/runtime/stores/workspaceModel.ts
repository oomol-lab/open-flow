import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { Diagnostic, Draft, Flow, FlowCheck, Live, Presentation } from '../api.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { DiagnosticFocus, DiagnosticItem } from '../editor/diagnostics.ts'
import type { ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { FlowCatalog } from './flowCatalog.ts'

import { compute, derive, val } from 'value-enhancer'
import { deriveAddNodeOptions } from '../editor/addNodeOptions.ts'
import { diagnosticItems, deriveInspectorDiagnostics } from '../editor/diagnostics.ts'
import { revisionView } from '../revisionView.ts'

export type WorkspaceBusy = 'designer' | 'flow' | 'resource'
export type WorkspaceStatus = 'loading' | 'noDraft' | 'saved' | 'saving' | 'failed'
export type ModuleEditorStatus = 'dirty' | 'failed' | 'saved' | 'saving'

export interface ModuleEditor {
  readonly moduleId: string
  readonly source: string
  readonly status: ModuleEditorStatus
}

export interface NodeFocus {
  readonly nodeId: string
  readonly requestId: number
}

export interface ModuleEditorDraft {
  readonly moduleId: string
  readonly phase?: 'failed' | 'saving'
  readonly source: string
}

export interface WorkspaceState {
  readonly busy?: WorkspaceBusy
  readonly checkLoading: boolean
  readonly diagnosticFocus?: DiagnosticFocus
  readonly diagnostics?: FlowCheck
  readonly draft?: Draft
  readonly flowId?: string
  readonly live?: Live
  readonly moduleEditor?: ModuleEditorDraft
  readonly moduleSaveStatus?: 'saving' | 'failed'
  readonly nodeFocus?: NodeFocus
  readonly presentation?: Presentation
  readonly selectedNodeIds: readonly string[]

  readonly workspaceLoadFailed: boolean
  readonly workspaceLoadProblem?: { readonly kind: 'failed' | 'repair' | 'upgrade'; readonly message?: string }
  readonly workspaceLoading: boolean
  readonly workspaceRepairing: boolean
}

export interface Workspace$ {
  readonly addNodeOptions: ReadonlyVal<readonly AddNodeOption[]>
  readonly busy: ReadonlyVal<WorkspaceBusy | undefined>
  readonly checkLoading: ReadonlyVal<boolean>
  readonly diagnostics: ReadonlyVal<FlowCheck | undefined>
  readonly diagnosticFocus: ReadonlyVal<DiagnosticFocus | undefined>
  readonly diagnosticItems: ReadonlyVal<readonly DiagnosticItem[]>
  readonly draft: ReadonlyVal<Draft | undefined>
  readonly flow: ReadonlyVal<Flow | undefined>
  readonly flowId: ReadonlyVal<string | undefined>
  readonly flowLoadFailed: ReadonlyVal<boolean>
  readonly flowLoadMoreFailed: ReadonlyVal<boolean>
  readonly flowLoading: ReadonlyVal<boolean>
  readonly flowLoadingMore: ReadonlyVal<boolean>
  readonly flowNextCursor: ReadonlyVal<string | undefined>
  readonly flowRefreshing: ReadonlyVal<boolean>
  readonly flowTotal: ReadonlyVal<number | undefined>
  readonly flows: ReadonlyVal<readonly Flow[]>
  readonly inspectorDiagnostics: ReadonlyVal<readonly Diagnostic[]>
  readonly live: ReadonlyVal<Live | undefined>
  readonly moduleEditor: ReadonlyVal<ModuleEditor | undefined>
  readonly nodeFocus: ReadonlyVal<NodeFocus | undefined>
  readonly presentation: ReadonlyVal<Presentation | undefined>
  readonly revision: ReadonlyVal<RevisionView | undefined>
  readonly selection: ReadonlyVal<ResolvedSelection | undefined>
  readonly selectedNodeIds: ReadonlyVal<readonly string[]>
  readonly status: ReadonlyVal<WorkspaceStatus>

  readonly workspaceLoadFailed: ReadonlyVal<boolean>
  readonly workspaceLoadProblem: ReadonlyVal<WorkspaceState['workspaceLoadProblem']>
  readonly workspaceLoading: ReadonlyVal<boolean>
  readonly workspaceRepairing: ReadonlyVal<boolean>
}

const initialState: WorkspaceState = {
  checkLoading: false,
  selectedNodeIds: [],
  workspaceLoadFailed: false,
  workspaceLoading: false,
  workspaceRepairing: false,
}

function status(state: WorkspaceState): WorkspaceStatus {
  if (state.workspaceLoading) return 'loading'
  if (state.moduleSaveStatus != null) return state.moduleSaveStatus
  if (state.busy == 'designer') return 'saving'
  if (state.draft == null) return 'noDraft'
  return 'saved'
}

export function moduleEditorStatus(draft: Draft | undefined, editor: ModuleEditorDraft): ModuleEditorStatus {
  if (editor.phase != null) return editor.phase
  const module = draft?.content.modules[editor.moduleId]
  if (module == null) return 'failed'
  return editor.source == module.source ? 'saved' : 'dirty'
}

export function selectedModuleEditor(revision: RevisionView | undefined, nodeIds: readonly string[]): ModuleEditorDraft | undefined {
  if (revision == null || nodeIds.length != 1) return
  const node = revision.node(nodeIds[0]!)
  if (node?.kind != 'task' || node.definition == null || !('moduleId' in node.definition) || node.module == null) return
  return {
    moduleId: node.definition.moduleId,
    source: node.module.source,
  }
}

export class WorkspaceModel {
  readonly #state: Val<WorkspaceState> = val(initialState)
  readonly #catalogValues: ReadonlySet<ReadonlyVal<unknown>>
  public readonly $: Workspace$

  public constructor(i18n: I18n, flows: FlowCatalog) {
    const busy = derive(this.#state, (state) => state.busy)
    const checkLoading = derive(this.#state, (state) => state.checkLoading)
    const diagnosticFocus = derive(this.#state, (state) => state.diagnosticFocus)
    const diagnostics = derive(this.#state, (state) => state.diagnostics)
    const draft = derive(this.#state, (state) => state.draft)
    const moduleEditor = derive(this.#state, (state) => {
      if (state.moduleEditor == null) return
      const { phase: _phase, ...editor } = state.moduleEditor
      return {
        ...editor,
        status: moduleEditorStatus(state.draft, state.moduleEditor),
      }
    })
    const nodeFocus = derive(this.#state, (state) => state.nodeFocus)
    const presentation = derive(this.#state, (state) => state.presentation)
    const flowId = derive(this.#state, (state) => state.flowId)
    const live = derive(this.#state, (state) => state.live)
    const revision = derive(this.#state, (state) => (state.draft == null ? undefined : revisionView(state.draft)))
    const selectedNodeIds = derive(this.#state, (state) => state.selectedNodeIds)
    const workspaceLoadFailed = derive(this.#state, (state) => state.workspaceLoadFailed)
    const workspaceLoadProblem = derive(this.#state, (state) => state.workspaceLoadProblem)
    const workspaceLoading = derive(this.#state, (state) => state.workspaceLoading)
    const workspaceRepairing = derive(this.#state, (state) => state.workspaceRepairing)
    const selection = derive(this.#state, (state) => {
      if (state.draft == null || state.selectedNodeIds.length != 1) return
      return revisionView(state.draft).selection(state.selectedNodeIds[0]!)
    })
    this.$ = {
      addNodeOptions: compute((get) => {
        const currentRevision = get(revision)
        return deriveAddNodeOptions(currentRevision?.revision, get(i18n.t$))
      }),
      busy,
      checkLoading,
      diagnosticFocus,
      diagnosticItems: derive(this.#state, (state) => diagnosticItems(state.draft == null ? undefined : revisionView(state.draft), state.diagnostics)),
      diagnostics,
      draft,
      flow: compute((get) => {
        const selectedFlowId = get(flowId)
        return selectedFlowId == null ? undefined : get(flows.$.flows).find((flow) => flow.flowId == selectedFlowId)
      }),
      flowId,
      flowLoadFailed: flows.$.failed,
      flowLoadMoreFailed: flows.$.loadMoreFailed,
      flowLoading: flows.$.loading,
      flowLoadingMore: flows.$.loadingMore,
      flowNextCursor: flows.$.nextCursor,
      flowRefreshing: flows.$.refreshing,
      flowTotal: flows.$.total,
      flows: flows.$.flows,
      inspectorDiagnostics: derive(this.#state, (state) =>
        deriveInspectorDiagnostics(state.draft == null ? undefined : revisionView(state.draft), state.diagnostics, selection.value),
      ),
      live,
      moduleEditor,
      nodeFocus,
      presentation,
      revision,
      selection,
      selectedNodeIds,
      status: derive(this.#state, status),
      workspaceLoadFailed,
      workspaceLoadProblem,
      workspaceLoading,
      workspaceRepairing,
    }
    this.#catalogValues = new Set(Object.values(flows.$))
  }

  public get value(): WorkspaceState {
    return this.#state.value
  }

  public set(patch: Partial<WorkspaceState>): void {
    this.#state.set({ ...this.#state.value, ...patch })
  }

  public dispose(): void {
    for (const value of Object.values(this.$)) {
      if (!this.#catalogValues.has(value)) value.dispose()
    }
    this.#state.dispose()
  }
}
