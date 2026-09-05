import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal } from 'value-enhancer'
import type { HandleInputFrom, NodeId } from '../../../../schema/index.ts'

import { NodeManifestKind } from './internal.ts'

export type NodeType = 'task' | 'subflow' | 'value' | 'condition' | 'trigger'

export interface NodeManifest$ {
  readonly title: ReadonlyVal<string | undefined>
  readonly icon: ReadonlyVal<string | undefined>
  readonly description: ReadonlyVal<string | undefined>
  readonly inputs_from: ReadonlyVal<readonly HandleInputFrom[] | undefined>
  readonly ignore: ReadonlyVal<boolean | undefined>
}

export interface ProgressNodeManifest$ extends NodeManifest$ {
  readonly progress_weight: ReadonlyVal<number | undefined>
}

export interface ScheduledNodeManifest$ extends ProgressNodeManifest$ {
  readonly timeout: ReadonlyVal<number | undefined>
}

export interface NodeManifest {
  readonly nodeId: NodeId
  readonly nodeType: NodeType
  readonly dispose: DisposableStore
  readonly KIND: Record<NodeManifestKind, boolean>
  readonly $: NodeManifest$
  clone(nodeId: NodeId): NodeManifest
  toJSON(): object
}

export function isNodeManifest(node: any): node is NodeManifest {
  return node?.KIND?.[NodeManifestKind] === true
}

export function toNodeManifest(node: unknown): NodeManifest | undefined {
  if (isNodeManifest(node)) {
    return node
  }
}
