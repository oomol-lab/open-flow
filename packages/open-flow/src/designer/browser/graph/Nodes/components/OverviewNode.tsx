import styles from './OverviewNode.module.scss'
import type { NodeStore } from '../../../stores/node/node.store.ts'

import { useUpdateNodeInternals } from '@xyflow/react'
import { clsx } from 'clsx'
import { memo, useEffect, useRef } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { DesignerIcon } from '../../../icons/DesignerIcon.tsx'
import { isPseudoNodeType, NODE_STATUS, NODE_TYPE } from '../../../stores/node/constants.ts'
import { ErrorNodeStore, parseError } from '../../../stores/node/errorNode.store.ts'
import { resolveOverviewNodeText, resolveOverviewPortCapability } from '../../../stores/node/overviewNode.ts'
import { toTaskNodeStore } from '../../../stores/node/taskNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { ConnectorConnectionBadge } from './ConnectorConnectionBadge.tsx'
import { iconForNodeType } from './constants.ts'

export interface OverviewNodeProps {
  readonly nodeStore: NodeStore
  readonly inputConnected?: boolean
  readonly outputConnected?: boolean
  readonly showError?: boolean
}

export const OverviewNode: React.FC<OverviewNodeProps> = /* @__PURE__ */ memo(function OverviewNode({ nodeStore, showError = false }) {
  const t = useTranslate()
  const designerStore = useDesignerStore()
  const scale = useVal(designerStore.$.scale)
  const selected = useVal(nodeStore.$.selected)
  const displayTitle = useVal(nodeStore.display$.title)
  const description = useVal(nodeStore.display$.description)
  const displayIcon = useVal(nodeStore.display$.icon)
  const inputDefinitions = useVal(nodeStore.display$.inputs_def)
  const outputDefinitions = useVal(nodeStore.display$.outputs_def)
  const status = useVal(nodeStore.display$.status)
  const progress = useVal(nodeStore.display$.progress)
  const error = useVal(ErrorNodeStore.is(nodeStore) ? nodeStore.error$ : undefined)
  const errorOutputHandles = useVal(ErrorNodeStore.is(nodeStore) ? nodeStore.outputHandles$ : undefined)
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const manifestTask = useVal(taskNodeStore?.manifest$?.task)
  const displayTask = useVal(taskNodeStore?.display$.task)
  const task = manifestTask ?? displayTask
  const executor = useVal(task != null && typeof task == 'object' ? task.executor : undefined)
  const [errorMessage] = parseError(error)

  const text = resolveOverviewNodeText({
    nodeType: nodeStore.nodeType,
    nodeId: nodeStore.nodeId,
    title: displayTitle,
    description,
    errorMessage,
    inputTitle: t('inputHandleEditor.title'),
    outputTitle: t('outputHandleEditor.title'),
  })
  const ports = resolveOverviewPortCapability({
    nodeType: nodeStore.nodeType,
    inputDefinitions,
    outputDefinitions,
    errorOutputHandles,
  })
  const fallbackIcon = overviewFallbackIcon(nodeStore.nodeType)
  const updateNodeInternals = useUpdateNodeInternals()
  const mounted = useRef(false)
  const running = status == NODE_STATUS.Running
  const success = status == NODE_STATUS.Success
  const failed = status == NODE_STATUS.Error
  const showProgress = running || success || (failed && progress != null)
  const progressWidth = showProgress ? (success ? 100 : Math.min(100, Math.max(0, progress ?? 0))) : 0
  const indeterminate = running && progress == null

  useEffect(() => {
    if (mounted.current) {
      updateNodeInternals(nodeStore.rfNodeId)
    } else {
      mounted.current = true
    }
  }, [nodeStore.rfNodeId, ports.hasInput, ports.hasOutput, updateNodeInternals])

  const icon =
    showError || nodeStore.nodeType == NODE_TYPE.ErrorNode ? (
      <span className={clsx(styles.icon, styles.errorIcon)}>
        <i className={showError ? 'i-codicon:warning' : fallbackIcon} />
      </span>
    ) : (
      <span className={styles.icon}>
        <DesignerIcon src={isPseudoNodeType(nodeStore.nodeType) ? undefined : displayIcon} fallback={<i className={fallbackIcon} />} />
      </span>
    )

  return (
    <div
      className={clsx(
        styles.container,
        NODE_HANDLE_CLASSNAME,
        isPseudoNodeType(nodeStore.nodeType) && styles.virtual,
        running && styles.running,
        success && styles.success,
        failed && styles.failed,
      )}
      style={{ outlineWidth: Math.max(selected ? 2 : 1, scale) }}
    >
      <span aria-hidden className={styles.progressTrack}>
        <span
          className={clsx(styles.progressFill, !showProgress && styles.progressInactive, success && styles.progressSuccess, failed && styles.progressFailed)}
          style={{ width: `${progressWidth}%` }}
        />
        {indeterminate && <span className={styles.indeterminate} />}
      </span>
      {showError ? (
        <DesignerTooltip placement="top" title={t('nodeStatus.hasError')}>
          {icon}
        </DesignerTooltip>
      ) : (
        icon
      )}
      <span className={styles.identity}>
        <strong className={styles.title} title={text.title}>
          {text.title}
        </strong>
        {executor?.name == 'connector' ? (
          <ConnectorConnectionBadge action={executor.options.action} className={styles.connection} connection={executor.options.connection} />
        ) : (
          text.summary && (
            <span className={styles.summary} title={text.summary}>
              {text.summary}
            </span>
          )
        )}
      </span>
    </div>
  )
})

function overviewFallbackIcon(nodeType: NodeStore['nodeType']): string {
  if (nodeType == NODE_TYPE.InputNode) {
    return 'i-carbon:port-input'
  } else if (nodeType == NODE_TYPE.OutputNode) {
    return 'i-carbon:port-output'
  } else if (nodeType == NODE_TYPE.ErrorNode) {
    return 'i-carbon:warning'
  } else {
    return iconForNodeType(nodeType)
  }
}
