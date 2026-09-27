import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'

export function WorkbenchInspectorToggle({
  label,
  open,
  disabled = false,
  onToggle,
}: {
  readonly label: string
  readonly open: boolean
  readonly disabled?: boolean
  readonly onToggle: (opener: HTMLButtonElement) => void
}) {
  return (
    <CanvasTooltip placement="bottom" title={label}>
      <Button
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => onToggle(event.currentTarget)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <i aria-hidden="true" className={open ? 'i-lucide-light:panel-right-close' : 'i-lucide-light:panel-right-open'} data-corner-icon />
      </Button>
    </CanvasTooltip>
  )
}
