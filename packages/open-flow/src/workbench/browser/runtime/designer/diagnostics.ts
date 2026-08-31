import type { TFunction } from 'val-i18n'
import type { Diagnostic, FlowCheck, GraphNode } from '../api.ts'
import type { ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { DesignerTarget } from './flowChanges.ts'

export type InspectorSection = 'account' | 'condition' | 'inputs' | 'module' | 'node' | 'task' | 'trigger'
export type DiagnosticScope = 'code' | 'flow' | 'node' | 'task'

export interface DiagnosticLocation {
  readonly nodeId: string
  readonly section: InspectorSection
}

export interface DiagnosticItem {
  readonly diagnostic: Diagnostic
  readonly location?: DiagnosticLocation
  readonly scope: DiagnosticScope
}

export interface DiagnosticFocus extends DiagnosticLocation {
  readonly diagnostic: Diagnostic
  readonly requestId: number
}

export function diagnosticMessage(diagnostic: Diagnostic, t: TFunction): string {
  const variant = diagnostic.values?.variant
  const key = `diagnostics.messages.${diagnostic.code}${typeof variant == 'string' ? `.${variant}` : ''}`
  const translated = t(key, diagnostic.values)
  return translated == key ? diagnostic.message : translated
}

function within(path: string, candidate: string): boolean {
  return candidate == path || candidate.startsWith(`${path}/`)
}

export function deriveInspectorDiagnostics(
  revision: RevisionView | undefined,
  target: DesignerTarget | undefined,
  diagnostics: FlowCheck | undefined,
  selection: ResolvedSelection | undefined,
): readonly Diagnostic[] {
  if (revision == null || target == null || diagnostics == null) return []
  if (selection != null) return diagnosticsForNode(target, selection, diagnostics.diagnostics)
  const targetPath = target.kind == 'flow' ? '/document/graph' : `/document/subflows/${target.id}`
  return diagnostics.diagnostics.filter((diagnostic) => within(targetPath, diagnostic.path))
}

function scope(path: string): DiagnosticScope {
  if (path.startsWith('/modules/')) return 'code'
  if (/\/graph\/nodes\/[^/]+\/task(?:\/|$)/.test(path)) return 'task'
  if (path.includes('/graph/nodes/')) return 'node'
  if (path.startsWith('/document/tasks/')) return 'task'
  return 'flow'
}

function nodeSection(node: GraphNode, suffix: string): InspectorSection {
  if (suffix.startsWith('/inputs/')) return 'inputs'
  if (node.kind == 'task' && suffix.startsWith('/task')) return 'task'
  if ((node.kind == 'poll' || node.kind == 'integration') && suffix.startsWith('/bindingId')) return 'account'
  if (node.kind == 'condition' && (suffix.startsWith('/cases/') || suffix.startsWith('/input') || suffix.startsWith('/defaultOutput'))) {
    return 'condition'
  }
  return 'node'
}

function location(revision: RevisionView | undefined, target: DesignerTarget | undefined, diagnostic: Diagnostic): DiagnosticLocation | undefined {
  if (revision == null || target == null) return
  const graphPrefix = target.kind == 'flow' ? '/document/graph/nodes/' : `/document/subflows/${target.id}/graph/nodes/`
  if (diagnostic.path.startsWith(graphPrefix)) {
    const path = diagnostic.path.slice(graphPrefix.length)
    const slash = path.indexOf('/')
    const nodeId = slash < 0 ? path : path.slice(0, slash)
    const node = revision.node(target, nodeId)
    if (node != null)
      return {
        nodeId,
        section: nodeSection(node.node, slash < 0 ? '' : path.slice(slash)),
      }
    return
  }

  const taskMatch = /^\/document\/tasks\/([^/]+)(.*)$/.exec(diagnostic.path)
  if (taskMatch != null) {
    const nodeId = revision.findTaskNode(target, new Set([taskMatch[1]!]))
    if (nodeId == null) return
    const suffix = taskMatch[2]!
    return {
      nodeId,
      section: suffix.startsWith('/executor') ? 'account' : 'task',
    }
  }

  const moduleMatch = /^\/modules\/([^/]+)\/source$/.exec(diagnostic.path)
  if (moduleMatch != null) {
    const nodeId = revision.findModuleNode(target, moduleMatch[1]!)
    if (nodeId != null) return { nodeId, section: 'module' }
  }
}

export function diagnosticItems(
  revision: RevisionView | undefined,
  target: DesignerTarget | undefined,
  check: FlowCheck | undefined,
): readonly DiagnosticItem[] {
  return (
    check?.diagnostics.map((diagnostic) => ({
      diagnostic,
      location: location(revision, target, diagnostic),
      scope: scope(diagnostic.path),
    })) ?? []
  )
}

function diagnosticsForNode(target: DesignerTarget, node: ResolvedSelection, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const nodePath = target.kind == 'flow' ? `/document/graph/nodes/${node.id}` : `/document/subflows/${target.id}/graph/nodes/${node.id}`
  const paths = [nodePath]
  if (node.kind == 'task') {
    if (node.node.task != null) paths.push(`${nodePath}/task`)
    else paths.push(`/document/tasks/${node.node.taskId}`)
    const moduleId = node.definition != null && 'moduleId' in node.definition ? node.definition.moduleId : undefined
    if (moduleId != null) paths.push(`/modules/${moduleId}`)
  } else if (node.kind == 'subflow') {
    paths.push(`/document/subflows/${node.node.subflowId}`)
  }
  return diagnostics.filter((diagnostic) => paths.some((path) => within(path, diagnostic.path)))
}
