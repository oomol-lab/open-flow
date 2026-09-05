import styles from './NodeHead.module.scss'

import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../../ui/browser/button.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { toTrue } from '../../../base/trivial.ts'
import { DesignerIcon2 } from '../../../components/designerIcon2.tsx'
import { TranslationInput } from '../../../components/input2.tsx'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { FlowDesignerStore } from '../../../stores/designer/flowDesigner.store.ts'
import { SUBFLOW_VIEW_MODE } from '../../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE, FLOW_RUN_STATUS } from '../../../stores/designer/typings.ts'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { isManifestNodeType } from '../../../stores/node/constants.ts'
import { TaskNodeStore } from '../../../stores/node/taskNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { useSubflowViewMode } from '../../SubflowDesigner/SubflowViewModeContext.ts'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { CommentNodeActions } from './CommentNodeActions.tsx'
import { ConnectorConnectionBadge } from './ConnectorConnectionBadge.tsx'
import { iconForNodeType } from './constants.ts'
import { NodeHeadContextMenu, NodeHeadMoreMenu } from './NodeHeadMoreMenu.tsx'
import { useShowNodeError } from './useShowNodeError.ts'

export const NodeHead: React.FC = /* @__PURE__ */ memo(function NodeHead() {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const skip = useVal(nodeStore.display$?.ignore)
  const showError = useShowNodeError(nodeStore)
  const designerStore = useDesignerStore()
  const designerType = designerStore.designerType
  const subflowViewMode = useSubflowViewMode()
  const isInBlock = designerType == DESIGNER_TYPE.Block || subflowViewMode == SUBFLOW_VIEW_MODE.Block
  const editable = useVal(designerStore.$.editable)

  const fallbackIcon = iconForNodeType(nodeStore.nodeType)
  const isCommentNode = CommentNodeStore.is(nodeStore)
  const placeholder = isInBlock || isCommentNode ? t('blockEditor.nodeTitlePlaceholder') : nodeStore.nodeId
  const hasMoreMenu = isManifestNodeType(nodeStore.nodeType) || (isCommentNode && !!nodeStore.duplicateNode)
  const runStatus = useVal(designerStore.$.runStatus)
  const task = useVal(TaskNodeStore.is(nodeStore) ? nodeStore.manifest$?.task || nodeStore.display$.task : undefined)
  const executor = useVal(task != null && typeof task == 'object' ? task.executor : undefined)

  const nodeTitle = nodeStore.display$ ? (
    <TranslationInput
      returnToCommit
      doubleClickToSelect
      className={styles.title}
      rawValue$={toTrue(editable) && nodeStore.manifest$?.title}
      displayValue$={nodeStore.display$.title}
      placeholder={placeholder}
      translationFallback={isInBlock ? undefined : nodeStore.nodeId}
      useRealChange
    />
  ) : (
    <TranslationInput
      returnToCommit
      doubleClickToSelect
      className={styles.title}
      rawValue$={nodeStore.$$.title}
      displayValue$={nodeStore.$.title}
      placeholder={placeholder}
      useRealChange
      translateKeyHint={`comment:${nodeStore.nodeId}:title`}
    />
  )

  return (
    <header className={`${styles.container} ${NODE_HANDLE_CLASSNAME}`}>
      {nodeStore.display$ &&
        (showError ? (
          <DesignerTooltip placement="top" title={t('nodeStatus.hasError')}>
            <span className={styles.errorIcon}>
              <i className="i-codicon:warning" />
            </span>
          </DesignerTooltip>
        ) : (
          <span className={styles.nodeIcon}>
            <DesignerIcon2
              rawIcon$={toTrue(editable) && nodeStore.manifest$?.icon}
              displayIcon$={nodeStore.display$.icon}
              fallback={<i className={fallbackIcon} />}
            />
          </span>
        ))}
      {CommentNodeStore.is(nodeStore) && (
        <span className={styles.commentIcon}>
          <i className="i-codicon:note" />
        </span>
      )}
      {isInBlock ? nodeTitle : <NodeHeadContextMenu designerStore={designerStore}>{nodeTitle}</NodeHeadContextMenu>}
      {executor?.name == 'connector' && (
        <ConnectorConnectionBadge action={executor.options.action} className={styles.connection} connection={executor.options.connection} />
      )}
      {FlowDesignerStore.is(designerStore) && nodeStore.execute ? (
        <Button
          aria-label={t('nodeActions.execute')}
          disabled={skip || runStatus !== FLOW_RUN_STATUS.Idle}
          onClick={() => nodeStore.execute!(true)}
          size="icon-xs"
          title={t('nodeActions.execute')}
          variant="ghost"
        >
          <i className="i-codicon:play" />
        </Button>
      ) : (
        isInBlock &&
        TaskNodeStore.is(nodeStore) &&
        nodeStore.openSharedTaskSource && (
          <Button
            aria-label={t('nodeActions.openSharedBlockCode')}
            onClick={nodeStore.openSharedTaskSource}
            size="icon-xs"
            title={t('nodeActions.openSharedBlockCode')}
            variant="ghost"
          >
            <i className="i-codicon:code" />
          </Button>
        )
      )}
      {CommentNodeStore.is(nodeStore) && <CommentNodeActions designerStore={designerStore} nodeStore={nodeStore} />}
      {hasMoreMenu && <NodeHeadMoreMenu />}
    </header>
  )
})
