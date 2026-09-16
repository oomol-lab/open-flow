import styles from './fieldTable.module.scss'
import type { ComponentPropsWithoutRef } from 'react'

import { forwardRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Checkbox } from '../../ui/browser/checkbox.tsx'

/** Shared field geometry. Callers own definitions, values, actions and persistence. */
export const FieldTable = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & {
    layout?: 'values' | 'ports' | 'definition'
    fixedTypes?: boolean
    output?: boolean
    nullable?: boolean
    empty?: boolean
  }
>(({ layout = 'definition', fixedTypes, output, nullable, empty, className, children, ...props }, ref) => {
  const t = useTranslate()
  return (
    <div
      {...props}
      ref={ref}
      className={[styles.list, className].filter(Boolean).join(' ')}
      data-layout={layout}
      data-fixed-types={fixedTypes || undefined}
      data-nullable={nullable || undefined}
      data-empty={empty || undefined}
    >
      {!empty && (
        <div className={styles.columns} data-layout={layout} data-output={output || undefined}>
          <span>{t('valueEditor.columnName')}</span>
          <span>{t('valueEditor.columnType')}</span>
          {!output && <span className={styles.valueHeading}>{t('valueEditor.columnValue')}</span>}
          {nullable && <span className={styles.nullableHeading}>{t('valueEditor.nullable')}</span>}
        </div>
      )}
      {children}
    </div>
  )
})

export function FieldTableRow({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={[styles.row, className].filter(Boolean).join(' ')} />
}

export function FieldNullable({ name, checked, onChange }: { name: string; checked: boolean; onChange?: (checked: boolean) => void }) {
  const t = useTranslate()
  return (
    <span className={styles.nullableControl}>
      <Checkbox
        className="not-data-disabled:cursor-pointer"
        aria-label={`${name} ${t(!onChange && !checked ? 'valueEditor.notNullable' : 'valueEditor.nullable')}`}
        aria-checked={checked}
        checked={checked}
        indeterminate={!onChange && !checked}
        disabled={!onChange}
        onCheckedChange={(next) => onChange?.(next === true)}
      />
    </span>
  )
}
