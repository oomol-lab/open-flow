import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { useCanvasStore } from '../../CanvasStoreContext.tsx'
import { CanvasCard } from './CanvasCard.tsx'
import { CommentNodeActions } from './CommentNodeActions.tsx'
import { CommentNodeContent } from './CommentNodeContent.tsx'
import { CommentTitle } from './NodeHead.tsx'
import { NodeHeadContextMenu } from './NodeHeadMoreMenu.tsx'

export function CommentCard({ store }: { readonly store: CommentNodeStore }) {
  const t = useTranslate()
  const canvasStore = useCanvasStore()
  const title = useVal(store.$.title) ?? ''
  const selected = useVal(store.$.selected)
  return (
    <div className={NODE_HANDLE_CLASSNAME}>
      <CanvasCard
        tone="comment"
        title={title}
        titleContent={
          <NodeHeadContextMenu canvasStore={canvasStore}>
            <CommentTitle store={store} />
          </NodeHeadContextMenu>
        }
        subtitle={t('addNode.comment')}
        icon={<i className="i-codicon:note" />}
        selected={selected}
        actions={<CommentNodeActions canvasStore={canvasStore} nodeStore={store} />}
        preview={<CommentNodeContent store={store} />}
      />
    </div>
  )
}
