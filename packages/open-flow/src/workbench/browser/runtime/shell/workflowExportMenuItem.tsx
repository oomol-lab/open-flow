import { useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { DropdownMenuItem } from '../../../../ui/browser/dropdown-menu.tsx'

/** Finish the menu's focus restoration before an export dialog can open. */
export function useWorkflowExportAction(onExport: (() => void) | undefined) {
  const requested = useRef(false)
  return {
    onClick: () => {
      requested.current = true
    },
    onOpenChangeComplete: (open: boolean) => {
      if (!open && requested.current) {
        requested.current = false
        onExport?.()
      }
    },
  }
}

export function WorkflowExportMenuItem({
  disabled,
  onClick,
  className,
}: {
  readonly disabled: boolean
  readonly onClick: () => void
  readonly className?: string
}) {
  const t = useTranslate()
  return (
    <DropdownMenuItem disabled={disabled} onClick={onClick} className={className}>
      <i aria-hidden="true" className="i-lucide-light:download size-4 shrink-0" />
      {t('resource.exportFlow')}
    </DropdownMenuItem>
  )
}
