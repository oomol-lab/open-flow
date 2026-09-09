import styles from './NodeHead.module.scss'

import { memo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { Input } from '../../../components/input.tsx'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { CommentNodeActions } from './CommentNodeActions.tsx'
import { NodeHeadContextMenu, NodeHeadMoreMenu } from './NodeHeadMoreMenu.tsx'

export const NodeHead = /* @__PURE__ */ memo(function NodeHead({ actionsOnly = false }: { actionsOnly?: boolean }) {
  const nodeStore = useNodeStore()
  const designerStore = useDesignerStore()

  const isCommentNode = CommentNodeStore.is(nodeStore)
  const hasMoreMenu = !isCommentNode || !!nodeStore.duplicateNode

  return (
    <header className={`${styles.container} ${NODE_HANDLE_CLASSNAME}`}>
      {!actionsOnly && CommentNodeStore.is(nodeStore) && (
        <span className={styles.commentIcon}>
          <i className="i-codicon:note" />
        </span>
      )}
      {!actionsOnly && CommentNodeStore.is(nodeStore) && (
        <NodeHeadContextMenu designerStore={designerStore}>
          <CommentTitle store={nodeStore} />
        </NodeHeadContextMenu>
      )}
      {CommentNodeStore.is(nodeStore) && <CommentNodeActions designerStore={designerStore} nodeStore={nodeStore} />}
      {hasMoreMenu && <NodeHeadMoreMenu />}
    </header>
  )
})

function CommentTitle({ store }: { readonly store: CommentNodeStore }) {
  const t = useTranslate()
  const title = useVal(store.$.title)
  const [focused, setFocused] = useState(false)
  return (
    <Input
      returnToCommit
      doubleClickToSelect
      className={`${styles.title}${focused ? ' nodrag' : ''}`}
      value={title}
      title={title}
      placeholder={t('blockEditor.nodeTitlePlaceholder')}
      onRealChange={store.$$.title.set}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  )
}
