import styles from './NodeHead.module.scss'
import type { CanvasStore } from '../../../stores/canvas/canvas.store.ts'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../../ui/browser/button.tsx'
import { CanvasTooltip } from '../../../components/tooltip.tsx'

interface CommentNodeActionsProps {
  readonly canvasStore: CanvasStore
  readonly nodeStore: CommentNodeStore
}

export function CommentNodeActions({ canvasStore, nodeStore }: CommentNodeActionsProps): React.ReactElement | null {
  const t = useTranslate()
  const editable = useVal(canvasStore.$.editable)
  const sourceCode = useVal(nodeStore.$.sourceCode)

  if (!editable) return null

  return (
    <CanvasTooltip placement="bottom" title={sourceCode ? t('comment.preview') : t('comment.source')}>
      <Button
        className={styles.action}
        aria-label={sourceCode ? t('comment.preview') : t('comment.source')}
        disabled={!editable}
        onClick={nodeStore.togglePreview}
        size="icon-xs"
        variant="ghost"
      >
        <i className={sourceCode ? 'i-codicon:wand' : 'i-codicon:go-to-file'} />
      </Button>
    </CanvasTooltip>
  )
}
