import type { KeyboardEvent, ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { DiagnosticItem, DiagnosticScope } from '../designer/diagnostics.ts'

import { useEffect, useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { Icon } from '../icons.tsx'

interface Props {
  readonly checked: boolean
  readonly checking: boolean
  readonly items: readonly DiagnosticItem[]
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onSelect: (item: DiagnosticItem) => void
}

function scopeLabel(scope: DiagnosticScope, t: TFunction): string {
  return t(`diagnostics.scope.${scope}`)
}

export function DiagnosticsPanel({ checked, checking, items, onClose, onRefresh, onSelect }: Props): ReactElement {
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
            const content = (
              <>
                <span className="diagnostic-row-heading">
                  <Badge variant="secondary">{scopeLabel(item.scope, t)}</Badge>
                  <code>{item.diagnostic.code}</code>
                  {item.scope == 'code' && <span>{t('diagnostics.sourceLocation', { column: item.diagnostic.column + 1, line: item.diagnostic.line })}</span>}
                </span>
                <strong>{item.diagnostic.message}</strong>
                <code className="diagnostic-path">{item.diagnostic.path}</code>
                <span className="diagnostic-row-action">{t(item.location == null ? 'diagnostics.pathOnly' : 'diagnostics.locate')}</span>
              </>
            )
            return (
              <li key={`${item.diagnostic.path}:${item.diagnostic.line}:${item.diagnostic.column}:${item.diagnostic.code}:${index}`}>
                {item.location == null ? (
                  <div className="diagnostic-row unavailable">{content}</div>
                ) : (
                  <Button
                    aria-label={t('diagnostics.locateIssue', { message: item.diagnostic.message })}
                    className="diagnostic-row whitespace-normal"
                    onClick={() => onSelect(item)}
                    type="button"
                    variant="ghost"
                  >
                    {content}
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
