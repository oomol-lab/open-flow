import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react'

import { Label, TabsList, TabsTrigger } from '@oomol-lab/open-flow/ui'
import { forwardRef } from 'react'

/** Owns host page width, scrolling, and the surface inherited by local dialog portals. */
export const HostPage = forwardRef<HTMLElement, ComponentPropsWithoutRef<'main'>>(function HostPage({ children, className = '', ...props }, ref) {
  return (
    <main {...props} ref={ref} className={`host-surface host-page ${className}`}>
      <div className="host-page-content">{children}</div>
    </main>
  )
})

/** Navigation and its bottom spacing stay outside the page's scroll container. */
export function HostPageLayout({ navigation, children }: { readonly navigation: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="host-page-layout">
      <div className="host-surface host-page-navigation">
        <div className="host-page-navigation-content">{navigation}</div>
      </div>
      <div className="host-page-body">{children}</div>
    </div>
  )
}

/** Callers retain control state and validation; this owns field hierarchy and label semantics. */
export function HostField({
  id,
  label,
  description,
  action,
  children,
}: {
  readonly id: string
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="host-field">
      <div className="host-field-heading">
        <div className="host-field-label">
          <Label htmlFor={id}>{label}</Label>
          {action}
        </div>
        {description != null && <p id={`${id}-description`}>{description}</p>}
      </div>
      {children}
    </div>
  )
}

type PageTab<Value extends string> = { readonly label: ReactNode; readonly value: Value }

/** Route navigation uses anchors; local panels use the shared accessible Tabs primitives. */
export function HostPageTabs<Value extends string>(
  props: {
    readonly label: string
    readonly items: readonly PageTab<Value>[]
  } & (
    | { readonly kind: 'panels' }
    | {
        readonly kind: 'routes'
        readonly active: Value
        readonly onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: Value) => void
      }
  ),
) {
  if (props.kind == 'panels') {
    return (
      <TabsList className="host-page-tabs" variant="navigation" aria-label={props.label}>
        {props.items.map((item) => (
          <TabsTrigger className="host-page-tab" key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    )
  }
  return (
    <nav className="host-page-tabs" aria-label={props.label}>
      {props.items.map((item) => (
        <a
          className="host-page-tab"
          key={item.value}
          href={item.value}
          aria-current={props.active == item.value ? 'page' : undefined}
          onClick={(event) => props.onNavigate(event, item.value)}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
