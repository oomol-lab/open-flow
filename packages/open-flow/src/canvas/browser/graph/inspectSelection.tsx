import { createContext, useContext } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { CanvasTooltip } from '../components/tooltip.tsx'

export const InspectSelectionContext = createContext<{ readonly onInspect?: () => void; readonly expanded: boolean }>({ expanded: false })

export function InspectSelectionButton({ className, danger = false }: { readonly className?: string; readonly danger?: boolean }) {
  const { onInspect, expanded } = useContext(InspectSelectionContext)
  const t = useTranslate()
  if (onInspect == null) return null
  const label = t('nodeActions.inspect')
  return (
    <CanvasTooltip placement="top" title={label}>
      <Button
        aria-expanded={expanded}
        aria-label={label}
        className={className}
        onClick={onInspect}
        size="icon"
        variant={danger && !expanded ? 'destructive-ghost' : 'ghost'}
      >
        <i aria-hidden="true" className="i-lucide-light:clipboard-list" />
      </Button>
    </CanvasTooltip>
  )
}
