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
  const hidden = useVal(store.$.contentHidden)
  const editing = useVal(store.$.sourceCode)
  const editable = useVal(canvasStore.$.editable)
  return (
    <div
      className={NODE_HANDLE_CLASSNAME}
      onDoubleClick={(event) => {
        if (!editable || !(event.target instanceof Element)) return
        if (event.target.closest('input, textarea, button, a, select, [role="checkbox"], [contenteditable="true"]')) return
        event.stopPropagation()
        store.$$.sourceCode.set(true)
      }}
    >
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
        preview={(!hidden || editing) && <CommentNodeContent store={store} />}
      />
    </div>
  )
}
