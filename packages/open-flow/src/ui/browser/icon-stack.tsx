import { ContentIcon } from './icons/ContentIcon.tsx'
import { cn } from './utils.ts'

/** A visual summary; the caller supplies an accessible label and tooltip. */
export function IconStack({
  icons,
  count,
  limit = 3,
  size = 'default',
  countClassName,
}: {
  readonly icons: readonly { readonly id: string; readonly icon: string }[]
  readonly count: number
  readonly limit?: number
  readonly size?: 'default' | 'sm'
  readonly countClassName?: string
}) {
  const frame = cn('relative flex shrink-0 items-center justify-center rounded-[6px] border border-border/50 bg-popover', size === 'sm' ? 'size-5' : 'size-6')
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1">
      <span className="inline-flex items-center -space-x-0.5">
        {icons.slice(0, limit).map((item) => (
          <span key={item.id} className={frame}>
            <ContentIcon src={item.icon} className={size === 'sm' ? 'size-3.5' : 'size-4'} />
          </span>
        ))}
      </span>
      <span className={cn('text-[10px] font-normal tabular-nums text-muted-foreground', countClassName)}>+{count}</span>
    </span>
  )
}
