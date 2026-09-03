import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { Diagnostic, Draft, Flow, FlowCheck, Live, Presentation } from '../api.ts'
import type { AddNodeOption } from '../designer/addNodeOptions.ts'
import type { DiagnosticFocus, DiagnosticItem } from '../designer/diagnostics.ts'
import type { DesignerTarget } from '../designer/flowChanges.ts'
import type { ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { FlowCatalog } from './flowCatalog.ts'

import { compute, derive, val } from 'value-enhancer'
import { deriveAddNodeOptions } from '../designer/addNodeOptions.ts'
import { diagnosticItems, deriveInspectorDiagnostics } from '../designer/diagnostics.ts'
import { revisionView } from '../revisionView.ts'

export type WorkspaceBusy = 'designer' | 'flow' | 'resource'
export type WorkspaceStatus = 'loading' | 'noDraft' | 'saved' | 'saving'
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
  readonly nodeFocus?: NodeFocus
  readonly presentation?: Presentation
  readonly selectedNodeIds: readonly string[]
  readonly target?: DesignerTarget
  readonly workspaceLoadFailed: boolean
  readonly workspaceLoading: boolean
}

interface RevisionContext {
  readonly revision?: RevisionView
  readonly target?: DesignerTarget
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
  readonly moduleDiagnostics: ReadonlyVal<readonly Diagnostic[]>
  readonly moduleEditor: ReadonlyVal<ModuleEditor | undefined>
  readonly nodeFocus: ReadonlyVal<NodeFocus | undefined>
  readonly presentation: ReadonlyVal<Presentation | undefined>
  readonly revision: ReadonlyVal<RevisionView | undefined>
  readonly selection: ReadonlyVal<ResolvedSelection | undefined>
  readonly selectedNodeIds: ReadonlyVal<readonly string[]>
  readonly status: ReadonlyVal<WorkspaceStatus>
  readonly target: ReadonlyVal<DesignerTarget | undefined>
  readonly targetFlow: ReadonlyVal<Flow | undefined>
  readonly targetName: ReadonlyVal<string | undefined>
  readonly workspaceLoadFailed: ReadonlyVal<boolean>
  readonly workspaceLoading: ReadonlyVal<boolean>
}

const initialState: WorkspaceState = {
  checkLoading: false,
  selectedNodeIds: [],
  workspaceLoadFailed: false,
  workspaceLoading: false,
}

function status(state: WorkspaceState): WorkspaceStatus {
  if (state.workspaceLoading) return 'loading'
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

export function selectedModuleEditor(
  revision: RevisionView | undefined,
  target: DesignerTarget | undefined,
  nodeIds: readonly string[],
): ModuleEditorDraft | undefined {
  if (revision == null || target == null || nodeIds.length != 1) return
  const node = revision.node(target, nodeIds[0]!)
  if (node?.kind != 'task' || node.definition == null || !('moduleId' in node.definition) || node.module == null) return
  return {
    moduleId: node.definition.moduleId,
    source: node.module.source,
  }
}

export class WorkspaceModel {
  readonly #revisionContext: ReadonlyVal<RevisionContext>
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
    const target = derive(this.#state, (state) => state.target)
    const workspaceLoadFailed = derive(this.#state, (state) => state.workspaceLoadFailed)
    const workspaceLoading = derive(this.#state, (state) => state.workspaceLoading)
    this.#revisionContext = derive(
      this.#state,
      (state) => ({
        revision: state.draft == null ? undefined : revisionView(state.draft),
        target: state.target,
      }),
      {
        equal: (next, previous) => next.revision === previous.revision && next.target === previous.target,
      },
    )
    const selection = derive(this.#state, (state) => {
      if (state.draft == null || state.target == null || state.selectedNodeIds.length != 1) return
      return revisionView(state.draft).selection(state.target, state.selectedNodeIds[0]!)
    })
    this.$ = {
      addNodeOptions: compute((get) => {
        const { revision: currentRevision, target: currentTarget } = get(this.#revisionContext)
        return deriveAddNodeOptions(currentRevision?.revision, currentTarget, get(i18n.t$))
      }),
      busy,
      checkLoading,
      diagnosticFocus,
      diagnosticItems: derive(this.#state, (state) =>
        diagnosticItems(state.draft == null ? undefined : revisionView(state.draft), state.target, state.diagnostics),
      ),
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
        deriveInspectorDiagnostics(state.draft == null ? undefined : revisionView(state.draft), state.target, state.diagnostics, selection.value),
      ),
      live,
      moduleDiagnostics: derive(this.#state, (state) => {
        const moduleId = state.moduleEditor?.moduleId
        return moduleId == null ? [] : (state.diagnostics?.diagnostics.filter((diagnostic) => diagnostic.path.startsWith(`/modules/${moduleId}/source`)) ?? [])
      }),
      moduleEditor,
      nodeFocus,
      presentation,
      revision,
      selection,
      selectedNodeIds,
      status: derive(this.#state, status),
      target,
      targetFlow: compute((get) => (get(target)?.kind == 'flow' ? get(flows.$.flows).find((flow) => flow.flowId == get(flowId)) : undefined)),
      targetName: derive(this.#state, (state) => {
        if (state.target == null) return
        if (state.target.kind == 'flow') return flows.flow(state.flowId ?? '')?.name
        if (state.draft == null) return state.target.id
        const currentRevision = revisionView(state.draft)
        return currentRevision.subflow(state.target.id)?.name ?? state.target.id
      }),
      workspaceLoadFailed,
      workspaceLoading,
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
    this.#revisionContext.dispose()
    this.#state.dispose()
  }
}
