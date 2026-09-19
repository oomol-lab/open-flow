import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../../../../ui/browser/utils.ts'

export function InspectorSection({
  title,
  children,
  className,
  contentInset = true,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & { readonly title: ReactNode; readonly contentInset?: boolean }) {
  return (
    <section className={cn('inspector-section inspector-titled-section', className)} {...props}>
      <h3 className="inspector-section-title">{title}</h3>
      <div className="inspector-section-content" data-inset={contentInset || undefined}>
        {children}
      </div>
    </section>
  )
}
