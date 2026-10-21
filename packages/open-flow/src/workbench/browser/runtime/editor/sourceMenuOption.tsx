import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { useTranslate } from 'val-i18n-react'
import { selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { DropdownMenuRadioItem } from '../../../../ui/browser/dropdown-menu.tsx'

export const sourceMenuItemClass = `${selectionMenuItemClass} gap-2 px-2`

/** Source menus share field identity, compatibility feedback, and description tooltips. */
export function SourceMenuOption({
  value,
  label,
  selected,
  compatibility = 'available',
  icon,
  description,
  disabled = false,
  container,
}: {
  readonly value: string
  readonly label: string
  readonly selected: boolean
  readonly compatibility?: 'available' | 'incompatible' | 'unverified'
  readonly icon?: string
  readonly description?: string
  readonly disabled?: boolean
  readonly container?: HTMLElement | null
}) {
  const t = useTranslate()
  const status =
    compatibility === 'incompatible' ? t('inspector.sources.incompatible') : compatibility === 'unverified' ? t('inspector.sources.unverified') : undefined
  const sourceDescription = description?.trim()
  const item = (
    <DropdownMenuRadioItem
      disabled={disabled}
      className={`${sourceMenuItemClass} data-disabled:opacity-100 ${status == null || selected ? 'pr-8' : 'pr-20'}`}
      value={value}
      closeOnClick
      aria-description={sourceDescription}
    >
      <i
        aria-hidden="true"
        className={`${icon ?? (status == null ? 'i-lucide-light:corner-down-right' : compatibility === 'incompatible' ? 'i-lucide-light:triangle-alert' : 'i-lucide-light:circle-help')} ${status == null ? 'text-muted-foreground' : ''} size-3.5 shrink-0`}
        style={status == null ? undefined : { color: 'var(--warning-foreground)' }}
      />
      <span className="min-w-0 flex-1 truncate font-mono" title={label}>
        {label}
      </span>
      {!selected && status != null && (
        <span className="pointer-events-none absolute right-2 shrink-0 text-[10px] leading-4" style={{ color: 'var(--warning-foreground)' }}>
          {status}
        </span>
      )}
      {selected && status != null && <span className="sr-only">{status}</span>}
    </DropdownMenuRadioItem>
  )
  if (sourceDescription == null || sourceDescription === '') return item
  // Intentionally use Base UI directly: source-option tooltips belong to a nested menu surface
  // and require its pointer-transparent portal and fixed side positioning, not the shared control-tooltip contract.
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={item} />
      <TooltipPrimitive.Portal container={container} className="contents">
        <TooltipPrimitive.Positioner side="right" align="start" sideOffset={8} positionMethod="fixed" className="pointer-events-none isolate z-[1000]">
          <TooltipPrimitive.Popup className="pointer-events-none max-w-64 rounded-[6px] bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-md outline-none">
            {sourceDescription}
            <TooltipPrimitive.Arrow className="size-2.5 rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-2.5" />
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
