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
  title,
}: {
  readonly className?: string
  readonly children: React.ReactElement
  readonly getPopupContainer?: () => HTMLElement
  readonly open?: boolean
  readonly placement?: TooltipPlacement
  readonly title?: React.ReactNode
}): React.ReactElement {
  const getStaticPopupContainer = useGetStaticPopupContainer()
  if (title == null || title === '') return children
  return (
    <Tooltip open={open}>
      <TooltipTrigger render={children} />
      <TooltipContent
        className={className}
        container={getPopupContainer?.() ?? (typeof document == 'undefined' ? undefined : getStaticPopupContainer())}
        side={side(placement)}
      >
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
