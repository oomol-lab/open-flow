import type { DisposableStore } from '@wopjs/disposable'
import type { XYPosition } from '@xyflow/react'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { Size } from '../../base/compare.ts'
import type { RFNode, RFNodeId } from '../../base/rfHelpers.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { NodeType } from './constants.ts'
import type { NodeInteraction } from './nodeInteraction.ts'

import { disposableStore } from '@wopjs/disposable'
import { val } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { toRFNodeId } from '../../base/rfHelpers.ts'
import { NODE_TYPE } from './constants.ts'
import { createNodeInteraction } from './nodeInteraction.ts'

const dragHandle = `.${NODE_HANDLE_CLASSNAME}`

export interface CommentNodeStore$$ {
  readonly rfNode: Val<RFNode>
  readonly selected: Val<boolean | undefined>
  readonly position: Val<XYPosition>
  readonly title: Val<string | undefined>
  readonly content: Val<string | undefined>
  readonly sourceCode: Val<boolean>
}

export interface CommentNodeStore$ extends ToReadonly$Group<CommentNodeStore$$> {
  readonly measured: ReadonlyVal<Partial<Size> | undefined>
}

export interface CommentNodeStoreProps {
  readonly position: XYPosition
  readonly title?: string
  readonly content?: string
  readonly duplicateNode?: (offset?: XYPosition | undefined) => void
  readonly onSaveContent: (content: string) => void
}

export class CommentNodeStore {
  public static is(store: unknown): store is CommentNodeStore {
    return store instanceof CommentNodeStore
  }

  public readonly dispose: DisposableStore = disposableStore()

  public readonly nodeType: NodeType = NODE_TYPE.CommentNode
  public readonly nodeId: NodeId

  public readonly rfNodeId: RFNodeId

  public readonly interaction: NodeInteraction

  public readonly $$: CommentNodeStore$$
  public readonly $: CommentNodeStore$
  public readonly duplicateNode: CommentNodeStoreProps['duplicateNode']
  public readonly saveContent: CommentNodeStoreProps['onSaveContent']

  public constructor(nodeId: NodeId, props: CommentNodeStoreProps) {
    this.nodeId = nodeId
    this.rfNodeId = toRFNodeId(nodeId, this.nodeType)
    this.duplicateNode = props.duplicateNode
    this.saveContent = props.onSaveContent

    const interaction = (this.interaction = this.dispose.add(
      createNodeInteraction(
        {
          id: this.rfNodeId,
          type: this.nodeType,
          position: props.position,
          dragHandle,
          data: Object.freeze({ store: this }),
        },
        350,
      ),
    ))

    this.$$ = {
      rfNode: interaction.rfNode,
      selected: interaction.selected,
      position: interaction.position,
      title: this.dispose.add(val(props.title)),
      content: this.dispose.add(val(props.content)),
      sourceCode: this.dispose.add(val(false)),
    }

    this.$ = {
      ...this.$$,
      measured: interaction.measured,
    }
  }

  public readonly togglePreview = (): void => {
    this.$$.sourceCode.set(!this.$.sourceCode.value)
  }
}
