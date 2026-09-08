import type { DesignerStore } from '../../../stores/designer/designer.store.ts'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../../ui/browser/button.tsx'
import { DesignerTooltip } from '../../../components/tooltip.tsx'

interface CommentNodeActionsProps {
  readonly designerStore: DesignerStore
  readonly nodeStore: CommentNodeStore
}

export function CommentNodeActions({ designerStore, nodeStore }: CommentNodeActionsProps): React.ReactElement | null {
  const t = useTranslate()
  const editable = useVal(designerStore.$.editable)
  const sourceCode = useVal(nodeStore.$.sourceCode)

  if (!editable) return null

  return (
    <DesignerTooltip placement="bottom" title={sourceCode ? t('comment.preview') : t('comment.source')}>
      <Button disabled={!editable} onClick={nodeStore.togglePreview} size="icon-xs" variant="ghost">
        <i className={sourceCode ? 'i-codicon:wand' : 'i-codicon:go-to-file'} />
      </Button>
    </DesignerTooltip>
  )
}
