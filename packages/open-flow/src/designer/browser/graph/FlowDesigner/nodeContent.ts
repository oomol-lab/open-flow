import type { FlowDesignerViewSemanticNode } from './model.ts'

/** Content comes from the canvas model; viewport position is owned by the interaction state. */
export type NodeContent<T = FlowDesignerViewSemanticNode> = T extends FlowDesignerViewSemanticNode ? Omit<T, 'position'> : never

export function nodeContent({ position: _position, ...content }: FlowDesignerViewSemanticNode): NodeContent {
  return content
}

export function portSchema(node: NodeContent | undefined, side: 'input' | 'output', handle: string): unknown {
  if (node == null) return undefined
  const ports = node.kind == 'value' ? node.values : side == 'output' ? node.outputs : node.inputs
  const port = ports.find((candidate) => 'handle' in candidate && candidate.handle == handle)
  return port != null && 'jsonSchema' in port ? port.jsonSchema : undefined
}
