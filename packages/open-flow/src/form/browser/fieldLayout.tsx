import branchStyles from './fieldBranch.module.scss'
import styles from './valueEditor.module.scss'
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'
import type { FieldDisclosure } from './fieldTypeDisplay.tsx'

import { createContext, forwardRef, useContext } from 'react'
import { Button } from '../../ui/browser/button.tsx'

interface FieldGeometry {
  columns?: CSSProperties['gridTemplateColumns']
  gap?: number
  depth: number
  layout: 'values' | 'ports' | 'definition'
}
const Geometry = createContext<FieldGeometry>({ depth: 0, layout: 'values' })
export function FieldLayout({ children, depth = 0, layout = 'values', columns, gap }: Partial<FieldGeometry> & { children: ReactNode }) {
  return <Geometry.Provider value={{ depth, layout, columns, gap }}>{children}</Geometry.Provider>
}
export interface FieldRowPresentation {
  columns?: CSSProperties['gridTemplateColumns']
  gap?: number
  header?: ReactNode | ((disclosure: FieldDisclosure | undefined) => ReactNode)
  leadingControl?: ReactNode
  disclosureContent?: ReactNode
  trailingControl?: ReactNode
  actions?: ReactNode
  layout?: FieldGeometry['layout']
  depth?: number
  typeWidth?: 'fixed' | 'editable' | 'output'
}
export const FieldRow = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> &
    FieldRowPresentation & {
      disclosure?: FieldDisclosure
      label: string
      sorting?: boolean
      disclosureInvalid?: boolean
    }
>(
  (
    {
      columns,
      gap,
      header,
      leadingControl,
      disclosureContent,
      trailingControl,
      actions,
      layout,
      depth,
      typeWidth,
      disclosure,
      label,
      sorting,
      disclosureInvalid,
      children,
      style,
      className,
      ...props
    },
    ref,
  ) => {
    const geometry = useContext(Geometry)
    const level = depth ?? geometry.depth
    return (
      <div
        {...props}
        ref={ref}
        className={[styles.root, className].filter(Boolean).join(' ')}
        data-layout={layout ?? geometry.layout}
        data-header={header != null || undefined}
        data-nested-field={level > 0 || undefined}
        style={
          {
            'gridTemplateColumns': columns ?? geometry.columns,
            'columnGap': gap ?? geometry.gap,
            '--field-indent': `${level * 16}px`,
            ...(typeWidth === 'fixed' ? { '--field-type-width': '32px' } : typeWidth === 'editable' ? { '--field-type-width': '56px' } : {}),
            ...style,
          } as CSSProperties
        }
      >
        {header != null && (
          <div className={styles.header}>
            {leadingControl != null && <div className={styles.leadingControl}>{leadingControl}</div>}
            <div className={styles.toggleControl}>
              {disclosure && (!sorting || leadingControl == null) && (
                <Button
                  type="button"
                  size="icon-xs"
                  className="w-[var(--field-toggle-width,24px)]"
                  variant="disclosure"
                  aria-label={label}
                  aria-expanded={disclosure.expanded}
                  aria-invalid={disclosureInvalid || undefined}
                  aria-controls={disclosure.controls}
                  onClick={disclosure.onToggle}
                >
                  {disclosureContent ?? (
                    <i aria-hidden="true" className={disclosure.expanded ? 'i-lucide-light:chevron-down' : 'i-lucide-light:chevron-right'} />
                  )}
                </Button>
              )}
              {!disclosure && leadingControl == null && disclosureContent}
            </div>
            {typeof header === 'function' ? header(disclosure) : header}
          </div>
        )}
        {children}
        {trailingControl}
        {actions != null && <div className={styles.options}>{actions}</div>}
      </div>
    )
  },
)

/** Expanded values stay in their cell; structural branches establish a child geometry and connector. */
export function FieldBody({
  placement,
  endpoint = 'control',
  depth,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  placement: 'inline' | 'branch'
  endpoint?: 'control' | 'marker'
  depth?: number
}) {
  const geometry = useContext(Geometry)
  return (
    <div
      {...props}
      className={[className, placement === 'branch' && branchStyles.branch].filter(Boolean).join(' ')}
      data-field-branch={placement === 'branch' || undefined}
      data-branch-endpoint={placement === 'branch' ? endpoint : undefined}
    >
      <FieldLayout {...geometry} depth={depth ?? geometry.depth + (placement === 'branch' ? 1 : 0)}>
        {children}
      </FieldLayout>
    </div>
  )
}
