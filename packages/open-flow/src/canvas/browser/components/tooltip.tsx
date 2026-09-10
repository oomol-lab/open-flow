import { useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/browser/tooltip.tsx'
import { useGetStaticPopupContainer } from '../graph/ReactFlowContainer/useGetPopupContainer.ts'

export type TooltipPlacement =
  | 'bottom'
  | 'bottomLeft'
  | 'bottomRight'
  | 'left'
  | 'leftBottom'
  | 'leftTop'
  | 'right'
  | 'rightBottom'
  | 'rightTop'
  | 'top'
  | 'topLeft'
  | 'topRight'

function side(placement: TooltipPlacement | undefined): 'bottom' | 'left' | 'right' | 'top' {
  if (placement?.startsWith('bottom')) return 'bottom'
  if (placement?.startsWith('left')) return 'left'
  if (placement?.startsWith('right')) return 'right'
  return 'top'
}

export function CanvasTooltip({
  className,
  children,
  getPopupContainer,
  open,
  placement,
  sideOffset,
  title,
}: {
  readonly className?: string
  readonly children: React.ReactElement
  readonly getPopupContainer?: () => HTMLElement
  readonly open?: boolean
  readonly placement?: TooltipPlacement
  readonly sideOffset?: number
  readonly title?: React.ReactNode
}): React.ReactElement {
  const getStaticPopupContainer = useGetStaticPopupContainer()
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  if (title == null || title === '') return children
  return (
    <Tooltip open={open ?? tooltipOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger ref={triggerRef} render={children} />
      <TooltipContent
        className={className}
        container={typeof document == 'undefined' ? undefined : (getPopupContainer?.() ?? getStaticPopupContainer())}
        side={side(placement)}
        align={
          placement?.endsWith('Left') || placement?.endsWith('Top') ? 'start' : placement?.endsWith('Right') || placement?.endsWith('Bottom') ? 'end' : 'center'
        }
        sideOffset={({ side: resolvedSide }) => {
          if (sideOffset !== undefined) return sideOffset
          const trigger = triggerRef.current
          const toolbar = trigger?.closest('[data-tooltip-toolbar], .react-flow__controls')
          if (!trigger || !toolbar) return 4
          const buttonBounds = trigger.getBoundingClientRect()
          const toolbarBounds = toolbar.getBoundingClientRect()
          // The rotated arrow extends about 5px past the bubble; leave 4px outside the toolbar.
          switch (resolvedSide) {
            case 'top':
              return 9 + buttonBounds.top - toolbarBounds.top
            case 'bottom':
              return 9 + toolbarBounds.bottom - buttonBounds.bottom
            case 'left':
              return 9 + buttonBounds.left - toolbarBounds.left
            case 'right':
              return 9 + toolbarBounds.right - buttonBounds.right
            default:
              return 9
          }
        }}
      >
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
