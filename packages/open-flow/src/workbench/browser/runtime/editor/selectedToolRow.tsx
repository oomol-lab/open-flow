import type { ReactNode } from 'react'

export function SelectedToolRow({
  icon,
  title,
  subtitle,
  actions,
  children,
}: {
  readonly icon: ReactNode
  readonly title: ReactNode
  readonly subtitle: ReactNode
  readonly actions: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 py-4 first:pt-1 last:pb-1">
      {icon}
      <div className="col-start-2 min-h-10 min-w-0">
        <h4 className="m-0 text-[13px] font-medium" title={typeof title == 'string' ? title : undefined}>
          {typeof title == 'string' ? <span className="block truncate">{title}</span> : title}
        </h4>
        <div className="flex min-w-0 items-center gap-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
      </div>
      {actions}
      <div className="col-start-2 min-w-0">{children}</div>
    </section>
  )
}
