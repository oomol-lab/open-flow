import type { KeyboardEvent, ReactElement } from 'react'
import type { DiagnosticItem } from '../editor/diagnostics.ts'

import { useEffect, useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { diagnosticMessage, diagnosticNodeId } from '../editor/diagnostics.ts'
import { Icon } from '../icons.tsx'

interface Props {
  readonly checked: boolean
  readonly checking: boolean
  readonly items: readonly DiagnosticItem[]
  readonly nodes: ReadonlyMap<string, { readonly title: string }>
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onSelect: (item: DiagnosticItem) => void
  readonly onSelectNode: (nodeId: string) => void
}

export function DiagnosticsPanel({ checked, checking, items, nodes, onClose, onRefresh, onSelect, onSelectNode }: Props): ReactElement {
  const t = useTranslate()
  const panel = useRef<HTMLElement>(null)

  useEffect(() => panel.current?.focus({ preventScroll: true }), [])

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key != 'Escape') return
    event.stopPropagation()
    onClose()
  }

  return (
    <aside
      aria-busy={checking}
      aria-labelledby="diagnostics-title"
      className="diagnostics-panel"
      id="diagnostics-panel"
      onKeyDown={keyDown}
      ref={panel}
      role="dialog"
      tabIndex={-1}
    >
      <header>
        <div>
          <strong id="diagnostics-title">{t('diagnostics.title')}</strong>
          <span aria-live="polite">
            {checking ? t('diagnostics.checking') : checked ? t('diagnostics.summary', { count: items.length }) : t('diagnostics.notChecked')}
          </span>
        </div>
        <div className="diagnostics-panel-actions">
          <Button disabled={checking} onClick={onRefresh} size="sm" variant="outline">
            {t('diagnostics.refresh')}
          </Button>
          <Button aria-label={t('diagnostics.close')} onClick={onClose} size="icon-sm" variant="ghost">
            <Icon name="close" />
          </Button>
        </div>
      </header>
      {items.length == 0 ? (
        checking ? (
          <div aria-label={t('diagnostics.checking')} className="flex flex-col gap-2.5 p-4" role="status">
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
          </div>
        ) : (
          <Empty className="min-h-60">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name="check" />
              </EmptyMedia>
              <EmptyTitle>{t(checked ? 'diagnostics.emptyTitle' : 'diagnostics.notCheckedTitle')}</EmptyTitle>
              <EmptyDescription>{t(checked ? 'diagnostics.emptyDescription' : 'diagnostics.notCheckedDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <ol className="diagnostics-list">
          {items.map((item, index) => {
            const referencedNodeId = diagnosticNodeId(item.diagnostic)
            const referencedNode = referencedNodeId == null ? undefined : nodes.get(referencedNodeId)
            const message = diagnosticMessage(item.diagnostic, t, (nodeId) => nodes.get(nodeId)?.title)
            return (
              <li key={`${item.diagnostic.path}:${item.diagnostic.line}:${item.diagnostic.column}:${item.diagnostic.code}:${index}`}>
                {referencedNodeId != null && referencedNode != null ? (
                  <button className="diagnostic-message" onClick={() => onSelectNode(referencedNodeId)} title={referencedNodeId} type="button">
                    {message}
                  </button>
                ) : item.location != null ? (
                  <button className="diagnostic-message" onClick={() => onSelect(item)} type="button">
                    {message}
                  </button>
                ) : (
                  <span className="diagnostic-message">{message}</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
