import styles from './sortableFieldList.module.scss'
import type { ReactNode } from 'react'

import { useContext, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { FieldSorting } from './fieldSorting.ts'

export function SortableFieldList({
  names,
  kind = 'object',
  getLabel,
  onReorder,
  children,
}: {
  names: readonly string[]
  kind?: 'object' | 'array'
  getLabel?: (name: string) => string
  onReorder?: (names: string[]) => void
  children: (name: string, handle?: ReactNode) => ReactNode
}) {
  const sorting = useContext(FieldSorting)
  const t = useTranslate()
  const list = useRef<HTMLDivElement>(null)
  const drag = useRef<{ name: string; x: number; y: number; order: string; insertion?: number }>()
  const [active, setActive] = useState<string>()
  const [insertion, setInsertion] = useState<number>()
  const cancel = () => {
    drag.current = undefined
    setActive(undefined)
    setInsertion(undefined)
  }
  const move = (name: string, destination: number) => {
    const from = names.indexOf(name)
    if (!onReorder || from < 0 || destination < 0 || destination >= names.length || from === destination) return
    const next = [...names]
    next.splice(from, 1)
    next.splice(destination, 0, name)
    onReorder(next)
  }
  return (
    <div ref={list} className={styles.list} data-object-fields={kind === 'object' || undefined} data-array-fields={kind === 'array' || undefined}>
      {names.map((name, index) => (
        <div
          key={name}
          data-sortable-field={name}
          data-object-field={kind === 'object' ? name : undefined}
          data-array-field={kind === 'array' ? name : undefined}
          className={styles.row}
          data-dragging={active === name || undefined}
          data-drop={insertion === index ? 'before' : insertion === names.length && index === names.length - 1 ? 'after' : undefined}
        >
          {children(
            name,
            sorting && onReorder && (
              <Button
                type="button"
                size="icon-xs"
                variant="disclosure"
                className={styles.grip}
                aria-label={t('valueEditor.reorder', { name: getLabel?.(name) ?? name })}
                title={t('valueEditor.reorderHint')}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  drag.current = { name, x: event.clientX, y: event.clientY, order: JSON.stringify(names) }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  const source = drag.current
                  if (!source || source.name !== name) return
                  if (source.order !== JSON.stringify(names)) return cancel()
                  if (Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5) return
                  setActive(name)
                  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sortable-field]')
                  const target = row?.parentElement === list.current ? names.indexOf(row.dataset.sortableField!) : -1
                  const rect = row?.getBoundingClientRect()
                  const boundary = target < 0 || !rect ? undefined : target + (event.clientY > rect.top + rect.height / 2 ? 1 : 0)
                  source.insertion = boundary === index || boundary === index + 1 ? undefined : boundary
                  setInsertion(source.insertion)
                }}
                onPointerUp={(event) => {
                  const source = drag.current
                  if (source?.insertion !== undefined && source.order === JSON.stringify(names))
                    move(name, source.insertion > index ? source.insertion - 1 : source.insertion)
                  cancel()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancel()
                  }
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.stopPropagation()
                    move(name, index + (event.key === 'ArrowUp' ? -1 : 1))
                  }
                }}
              >
                <i aria-hidden="true" className="i-lucide-light:grip-vertical" />
              </Button>
            ),
          )}
        </div>
      ))}
    </div>
  )
}
