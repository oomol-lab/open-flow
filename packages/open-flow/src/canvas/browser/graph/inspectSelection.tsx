import { createContext, useContext } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { CanvasTooltip } from '../components/tooltip.tsx'

export const InspectSelectionContext = createContext<(() => void) | undefined>(undefined)

export function InspectSelectionButton({ className }: { readonly className?: string }) {
  const onInspect = useContext(InspectSelectionContext)
  const t = useTranslate()
  if (onInspect == null) return null
  const label = t('nodeActions.inspect')
  return (
    <CanvasTooltip placement="top" title={label}>
      <Button aria-label={label} className={className} onClick={onInspect} size="icon" variant="ghost">
        <i aria-hidden="true" className="i-lucide-light:clipboard-list" />
      </Button>
    </CanvasTooltip>
  )
}
