import styles from './CanvasNode.module.scss'
import type { ReactNode } from 'react'
import type { NodeStore } from '../../../stores/node/node.store.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { ContentIcon } from '../../../../../ui/browser/icons/ContentIcon.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { imageSources, nodeSummary } from '../../FlowDesigner/cardContent.ts'
import { CanvasCard } from './CanvasCard.tsx'
import { iconForNodeType } from './constants.ts'
import { RunChips, ImagePreview } from './RunChips.tsx'

export function CanvasNode({ nodeStore, showError, branches }: { readonly nodeStore: NodeStore; readonly showError: boolean; readonly branches?: ReactNode }) {
  const t = useTranslate()
  const selected = useVal(nodeStore.$.selected)
  const node = useVal(nodeStore.content$)
  const title = node.title
  const icon = node.icon ?? (node.kind == 'wait' ? ':carbon:time:' : undefined)
  const tools = node.kind == 'task' ? node.tools : undefined
  const summary = nodeSummary(node, t)
  const images = imageSources(node?.run?.outputs)
  const problem = showError ? t('nodeStatus.hasError') : node?.run?.status == 'error' ? t('canvasCard.status.error') : undefined
  const kind = node?.kind ?? 'task'
  const inline = node?.kind == 'trigger' && summary && !summary.includes('\n') && summary.length <= 48
  const subtitle = inline ? summary : node?.kind == 'task' ? node.executorName || t('canvasCard.kind.task') : t(`canvasCard.kind.${kind}`)
  const distinctSubtitle = subtitle.trim().toLocaleLowerCase() == title.trim().toLocaleLowerCase() ? undefined : subtitle
  const toolContent = tools != null && tools.length > 0 && (
    <div className={styles.tools}>
      <span className={styles.toolsLabel}>{t('canvasCard.tools')}</span>
      <div className={styles.toolItems}>
        {tools.slice(0, 6).map((tool) => (
          <DesignerTooltip key={tool.id} placement="top" title={tool.label}>
            <span className={styles.tool} aria-label={tool.label} tabIndex={0}>
              <ContentIcon src={tool.icon} />
            </span>
          </DesignerTooltip>
        ))}
        {tools.length > 6 && (
          <DesignerTooltip
            placement="top"
            title={
              <div>
                {tools.slice(6).map((tool) => (
                  <div key={tool.id}>{tool.label}</div>
                ))}
              </div>
            }
          >
            <span className={styles.moreTools} tabIndex={0}>
              +{tools.length - 6}
            </span>
          </DesignerTooltip>
        )}
      </div>
    </div>
  )
  const runContent = node?.run == null || node.run.status == 'idle' ? undefined : <RunChips run={node.run} />
  return (
    <div className={NODE_HANDLE_CLASSNAME}>
      <CanvasCard
        title={title}
        icon={<ContentIcon src={icon} fallback={<i className={iconForNodeType(nodeStore.nodeType)} />} />}
        subtitle={distinctSubtitle}
        selected={selected}
        problem={problem}
        branches={branches}
        footer={
          toolContent || runContent ? (
            <div className={styles.footer}>
              {toolContent}
              {runContent}
            </div>
          ) : undefined
        }
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
