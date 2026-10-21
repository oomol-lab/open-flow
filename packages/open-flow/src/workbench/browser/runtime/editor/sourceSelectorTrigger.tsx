import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

/** Source actions share the attached addon's surface instead of drawing an inset button. */
export function SourceSelectorTrigger({
  label,
  description = label,
  open,
  pressed,
  disabled,
  container,
}: {
  readonly label: string
  readonly description?: string
  readonly open: boolean
  readonly pressed: boolean
  readonly disabled: boolean
  readonly container?: HTMLElement | null
}) {
  return (
    <Tooltip disabled={open}>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-source-trigger
                className="[--ui-control-hover-background:transparent] aria-pressed:text-foreground"
                aria-label={label}
                aria-pressed={pressed}
                disabled={disabled}
              >
                <i aria-hidden="true" className="i-lucide-light:link" />
              </Button>
            }
          />
        }
      />
      <TooltipContent container={container}>{description}</TooltipContent>
    </Tooltip>
  )
}
