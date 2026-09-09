import 'overlayscrollbars/overlayscrollbars.css'
import styles from './scroll-area.module.scss'
import type { EventListeners, PartialOptions } from 'overlayscrollbars'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'

import { clsx } from 'clsx'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { forwardRef } from 'react'

export type ScrollAreaRef = OverlayScrollbarsComponentRef<'div'>

export interface ScrollAreaProps {
  className?: string
  defer?: boolean
  events?: EventListeners
  style?: React.CSSProperties
  tabIndex?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  children?: React.ReactNode
}

const options: PartialOptions = {
  scrollbars: {
    theme: styles.scrollbar,
    autoHide: 'leave',
    autoHideDelay: 300,
  },
  overflow: { x: 'hidden' },
}

export const ScrollArea: React.ForwardRefExoticComponent<ScrollAreaProps & React.RefAttributes<ScrollAreaRef>> = forwardRef<ScrollAreaRef, ScrollAreaProps>(
  ({ className, defer = true, events, style, tabIndex, onClick, children }, ref) => {
    return (
      <OverlayScrollbarsComponent
        defer={defer}
        events={events}
        ref={ref}
        className={clsx(styles.container, className)}
        style={style}
        options={options}
        tabIndex={tabIndex}
        onClick={onClick}
      >
        {children}
      </OverlayScrollbarsComponent>
    )
  },
)
