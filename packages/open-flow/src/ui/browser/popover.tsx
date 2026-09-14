import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import * as React from 'react'
import { Button } from './button.tsx'
import { cn } from './utils.ts'

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverPrimitive.Trigger.Props>(function PopoverTrigger(props, ref) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} ref={ref} />
})

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  anchor,
  collisionBoundary,
  collisionAvoidance,
  positionMethod,
  container,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'collisionBoundary' | 'collisionAvoidance' | 'positionMethod' | 'anchor' | 'align' | 'alignOffset' | 'side' | 'sideOffset'
  > & {
    container?: HTMLElement | null
  }) {
  return (
    <PopoverPrimitive.Portal container={container} className="contents">
      <PopoverPrimitive.Positioner
        collisionBoundary={collisionBoundary}
        collisionAvoidance={collisionAvoidance}
        positionMethod={positionMethod}
        anchor={anchor}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none motion-reduce:transition-none',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('flex flex-col gap-0.5 text-sm', className)} {...props} />
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn('font-medium', className)} {...props} />
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={cn('text-muted-foreground', className)} {...props} />
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }

/** Additional property controls, anchored beside their owning field. */
function PopoverPanelContent({
  title,
  closeLabel,
  footer,
  children,
  ...props
}: Omit<React.ComponentProps<typeof PopoverContent>, 'title'> & { title: string; closeLabel: string; footer?: React.ReactNode }) {
  return (
    <PopoverContent
      collisionBoundary={[]}
      collisionAvoidance={{ side: 'flip', align: 'none', fallbackAxisSide: 'none' }}
      positionMethod="fixed"
      side="left"
      align="start"
      sideOffset={2}
      {...props}
      className={cn(
        'w-80 max-w-[calc(100vw-24px)] max-h-[min(80vh,680px,var(--available-height))] gap-0 overflow-hidden bg-background p-0 text-xs [--ui-control-radius:6px]',
        props.className,
      )}
    >
      <div className="flex min-h-10 shrink-0 items-center gap-2 px-3 py-2">
        <PopoverTitle className="min-w-0 flex-1 truncate text-xs">{title}</PopoverTitle>
        <PopoverPrimitive.Close render={<Button type="button" variant="ghost" size="icon-xs" aria-label={closeLabel} />}>
          <i aria-hidden="true" className="i-lucide-light:x" />
        </PopoverPrimitive.Close>
      </div>
      <div className="mx-2 h-px shrink-0 bg-border/50" />
      <div className="min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-3 py-3 pe-0.5 ps-3">{children}</div>
      </div>
      {footer && (
        <>
          <div className="mx-2 h-px shrink-0 bg-border/50" />
          <div className="flex shrink-0 items-center gap-2 px-3 py-3">{footer}</div>
        </>
      )}
    </PopoverContent>
  )
}
export { PopoverPanelContent }
