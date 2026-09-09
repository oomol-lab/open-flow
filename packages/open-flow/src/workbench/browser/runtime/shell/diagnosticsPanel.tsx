import type { KeyboardEvent, ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { DiagnosticItem, DiagnosticScope } from '../editor/diagnostics.ts'

import { useEffect, useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { diagnosticMessage } from '../editor/diagnostics.ts'
import { Icon } from '../icons.tsx'

interface Props {
  readonly checked: boolean
  readonly checking: boolean
  readonly items: readonly DiagnosticItem[]
  readonly nodes: ReadonlyMap<string, { readonly title: string }>
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onSelect: (item: DiagnosticItem) => void
}

function scopeLabel(scope: DiagnosticScope, t: TFunction): string {
  return t(`diagnostics.scope.${scope}`)
}

function groupItems(items: readonly DiagnosticItem[]): readonly (readonly DiagnosticItem[])[] {
  const groups: DiagnosticItem[][] = []
  const nodes = new Map<string, DiagnosticItem[]>()
  for (const item of items) {
    const nodeId = item.location?.nodeId
    if (nodeId == null) {
      groups.push([item])
      continue
    }
    const group = nodes.get(nodeId)
    if (group == null) {
      const next = [item]
      nodes.set(nodeId, next)
      groups.push(next)
    } else {
      group.push(item)
    }
  }
  return groups
}

export function DiagnosticsPanel({ checked, checking, items, nodes, onClose, onRefresh, onSelect }: Props): ReactElement {
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
          {groupItems(items).map((group, groupIndex) => {
            const location = group[0]?.location
            const title = location == null ? undefined : nodes.get(location.nodeId)?.title
            return (
              <li className="diagnostic-group" key={location == null ? `item:${groupIndex}` : `node:${location.nodeId}`}>
                {location != null && (
                  <div className="diagnostic-group-heading">
                    {title != null && <strong>{title}</strong>}
                    <span>{t('diagnostics.nodeId', { nodeId: location.nodeId })}</span>
                  </div>
                )}
                <ol>
                  {group.map((item, index) => {
                    const message = diagnosticMessage(item.diagnostic, t)
                    return (
                      <li key={`${item.diagnostic.path}:${item.diagnostic.line}:${item.diagnostic.column}:${item.diagnostic.code}:${index}`}>
                        <div className="diagnostic-row">
                          <span className="diagnostic-row-heading">
                            <Badge variant="secondary">{scopeLabel(item.scope, t)}</Badge>
                            <code>{item.diagnostic.code}</code>
                            {item.scope == 'code' && (
                              <span>{t('diagnostics.sourceLocation', { column: item.diagnostic.column + 1, line: item.diagnostic.line })}</span>
                            )}
                          </span>
                          <strong>{message}</strong>
                          <code className="diagnostic-path">{item.diagnostic.path}</code>
                          {item.location == null ? (
                            <span className="diagnostic-row-note">{t('diagnostics.pathOnly')}</span>
                          ) : (
                            <Button
                              aria-label={t('diagnostics.locateIssue', { message })}
                              className="self-start"
                              onClick={() => onSelect(item)}
                              size="xs"
                              type="button"
                              variant="link"
                            >
                              {t('diagnostics.locate')}
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
