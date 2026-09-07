import styles from './CanvasNode.module.scss'
import type { ReactNode } from 'react'
import type { NodeStore } from '../../../stores/node/node.store.ts'

import { useContext } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { DesignerIcon } from '../../../icons/DesignerIcon.tsx'
import { NODE_TYPE } from '../../../stores/node/constants.ts'
import { ErrorNodeStore, parseError } from '../../../stores/node/errorNode.store.ts'
import { CanvasContext } from '../../FlowDesigner/CanvasContext.ts'
import { imageSources, nodeSummary } from '../../FlowDesigner/cardContent.ts'
import { CanvasCard } from './CanvasCard.tsx'
import { iconForNodeType } from './constants.ts'
import { RunChips, ImagePreview } from './RunChips.tsx'

export function CanvasNode({ nodeStore, showError, branches }: { readonly nodeStore: NodeStore; readonly showError: boolean; readonly branches?: ReactNode }) {
  const t = useTranslate()
  const view = useContext(CanvasContext)
  const selected = useVal(nodeStore.$.selected)
  const title = useVal(nodeStore.display$.title) || nodeStore.nodeId
  const description = useVal(nodeStore.display$.description)
  const icon = useVal(nodeStore.display$.icon)
  const error = useVal(ErrorNodeStore.is(nodeStore) ? nodeStore.error$ : undefined)
  const [message] = parseError(error)
  const model = view?.model.nodes.find((node) => node.id == nodeStore.nodeId)
  const node = model?.kind == 'comment' ? undefined : model
  const summary = node ? nodeSummary(node, t) : description || message
  const images = imageSources(node?.run?.outputs)
  const problem = showError ? t('nodeStatus.hasError') : node?.run?.status == 'error' ? t('canvasCard.status.error') : undefined
  const kind = node?.kind ?? (nodeStore.nodeType == NODE_TYPE.InputNode ? 'input' : nodeStore.nodeType == NODE_TYPE.OutputNode ? 'output' : 'task')
  const inline = node?.kind == 'trigger' && summary && !summary.includes('\n') && summary.length <= 48
  const subtitle = inline ? summary : node?.kind == 'task' ? node.executorName || t('canvasCard.kind.task') : t(`canvasCard.kind.${kind}`)
  const distinctSubtitle = subtitle.trim().toLocaleLowerCase() == title.trim().toLocaleLowerCase() ? undefined : subtitle
  return (
    <div className={NODE_HANDLE_CLASSNAME}>
      <CanvasCard
        title={title}
        icon={<DesignerIcon src={icon} fallback={<i className={iconForNodeType(nodeStore.nodeType)} />} />}
        subtitle={distinctSubtitle}
        selected={selected}
        problem={problem}
        branches={branches}
        footer={node?.run == null || node.run.status == 'idle' ? undefined : <RunChips run={node.run} />}
        preview={node?.run && images.length > 0 ? <ImagePreview images={images} run={node.run} title={title} /> : undefined}
      >
        {!inline && summary && (
          <p className={styles.summary} title={summary}>
            {summary}
          </p>
        )}
      </CanvasCard>
    </div>
  )
}
