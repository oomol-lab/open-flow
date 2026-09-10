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

  const empty = useVal(nodeStore.$.empty)

  if (!editable || empty) return null

  return (
    <CanvasTooltip placement="top" title={sourceCode ? t('comment.preview') : t('comment.source')}>
      <Button
        className="text-[var(--text-2)] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)] hover:text-[var(--text-4)] dark:hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
        aria-label={sourceCode ? t('comment.preview') : t('comment.source')}
        disabled={!editable}
        onClick={nodeStore.togglePreview}
        size="icon-sm"
        variant="ghost"
      >
        <i aria-hidden="true" style={{ fontSize: 18 }} className={sourceCode ? 'i-codicon:eye' : 'i-codicon:code'} />
      </Button>
    </CanvasTooltip>
  )
}
