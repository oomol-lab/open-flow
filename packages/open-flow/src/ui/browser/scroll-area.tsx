import 'overlayscrollbars/overlayscrollbars.css'
import styles from './scroll-area.module.scss'
import type { EventListeners, PartialOptions } from 'overlayscrollbars'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import type { VListProps, VListHandle } from 'virtua'

import { clsx } from 'clsx'
import { OverlayScrollbarsComponent, useOverlayScrollbars } from 'overlayscrollbars-react'
import { forwardRef, useEffect, useRef } from 'react'
import { VList } from 'virtua'

export type ScrollAreaRef = OverlayScrollbarsComponentRef<'div'>

export interface ScrollAreaProps {
  className?: string
  defer?: boolean
  autoHide?: 'scroll' | 'leave' | 'never'
  events?: EventListeners
  style?: React.CSSProperties
  tabIndex?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  children?: React.ReactNode
}

const options: PartialOptions = {
  scrollbars: {
    theme: styles.scrollbar,
    autoHide: 'scroll',
    autoHideSuspend: false,
    autoHideDelay: 300,
  },
  overflow: { x: 'hidden' },
}

const leaveOptions: PartialOptions = {
  ...options,
  scrollbars: { ...options.scrollbars, autoHide: 'leave' },
}

const alwaysVisibleOptions: PartialOptions = {
  ...options,
  scrollbars: { ...options.scrollbars, autoHide: 'never' },
}

export const ScrollArea: React.ForwardRefExoticComponent<ScrollAreaProps & React.RefAttributes<ScrollAreaRef>> = forwardRef<ScrollAreaRef, ScrollAreaProps>(
  ({ className, defer = true, autoHide = 'scroll', events, style, tabIndex, onClick, children }, ref) => {
    return (
      <OverlayScrollbarsComponent
        defer={defer}
        events={events}
        ref={ref}
        className={clsx(styles.container, className)}
        style={style}
        options={autoHide === 'never' ? alwaysVisibleOptions : autoHide === 'leave' ? leaveOptions : options}
        tabIndex={tabIndex}
        onClick={onClick}
      >
        {children}
      </OverlayScrollbarsComponent>
    )
  },
)

export const NativeScrollArea = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div {...props} ref={ref} className={clsx(styles.container, styles.native, className)} />
))

/** Decorate the virtual list's own viewport without inserting a second scrolling element. */
export function VirtualScrollArea<T>({
  listRef,
  className,
  onScrollIntent,
  onWheel,
  onKeyDown,
  ...props
}: VListProps<T> & {
  readonly listRef: React.Ref<VListHandle>
  /** Called for user scroll gestures, excluding programmatic positioning and nested controls. */
  readonly onScrollIntent?: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [initialize] = useOverlayScrollbars({ options })
  useEffect(() => {
    const target = root.current
    if (target?.firstElementChild instanceof HTMLElement) initialize({ target, elements: { viewport: target.firstElementChild } })
  }, [initialize])
  return (
    <div
      ref={root}
      data-overlayscrollbars-initialize=""
      className={clsx(styles.container, className)}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest('.os-scrollbar') != null) onScrollIntent?.()
      }}
      onTouchStart={onScrollIntent}
    >
      <VList
        {...props}
        ref={listRef}
        onWheel={(event) => {
          onScrollIntent?.()
          onWheel?.(event)
        }}
        onKeyDown={(event) => {
          if (event.target == event.currentTarget && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onScrollIntent?.()
          onKeyDown?.(event)
        }}
      />
    </div>
  )
}
