import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { cn } from './utils.ts'

const Combobox = ComboboxPrimitive.Root
const ComboboxClear = ComboboxPrimitive.Clear

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return <ComboboxPrimitive.Input data-slot="combobox-input" className={cn(className)} {...props} />
}

function ComboboxContent({
  align = 'start',
  alignOffset = 0,
  className,
  container,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & { container?: HTMLElement | null }) {
  const content = (
    <ComboboxPrimitive.Positioner align={align} alignOffset={alignOffset} className="isolate z-50" side={side} sideOffset={sideOffset}>
      <ComboboxPrimitive.Popup
        data-slot="combobox-content"
        className={cn(
          'z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none motion-reduce:transition-none',
          className,
        )}
        {...props}
      />
    </ComboboxPrimitive.Positioner>
  )

  return <ComboboxPrimitive.Portal container={container}>{content}</ComboboxPrimitive.Portal>
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn('max-h-48 overflow-y-auto p-1', className)} {...props} />
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:bg-accent/60 data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn(className)} {...props} />
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-label" className={cn('px-1.5 py-1 text-xs text-muted-foreground', className)} {...props} />
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn('px-2 py-1 text-sm text-muted-foreground', className)} {...props} />
}

export { Combobox, ComboboxClear, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList }
