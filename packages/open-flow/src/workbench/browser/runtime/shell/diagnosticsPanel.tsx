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
  const groups: { nodeId?: string; items: DiagnosticItem[] }[] = []
  const nodeGroups = new Map<string, (typeof groups)[number]>()
  for (const item of items) {
    const nodeId = item.location?.nodeId
    if (nodeId == null || !nodes.has(nodeId)) {
      groups.push({ items: [item] })
      continue
    }
    let group = nodeGroups.get(nodeId)
    if (group == null) {
      group = { nodeId, items: [] }
      nodeGroups.set(nodeId, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  useEffect(() => panel.current?.focus({ preventScroll: true }), [])

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key != 'Escape') return
    event.stopPropagation()
    onClose()
  }

  function issueContent(item: DiagnosticItem): ReactElement {
    const referencedNodeId = diagnosticNodeId(item.diagnostic)
    const referencedNode = referencedNodeId == null ? undefined : nodes.get(referencedNodeId)
    const message = item.message ?? diagnosticMessage(item.diagnostic, t, (nodeId) => nodes.get(nodeId)?.title)
    if (referencedNodeId != null && referencedNode != null)
      return (
        <Button
          variant="link"
          size="xs"
          className="diagnostic-message h-auto whitespace-normal p-0 hover:underline focus-visible:underline"
          onClick={() => onSelectNode(referencedNodeId)}
          title={referencedNodeId}
          type="button"
        >
          {message}
        </Button>
      )
    if (item.location != null)
      return (
        <Button
          variant="link"
          size="xs"
          className="diagnostic-message h-auto whitespace-normal p-0 hover:underline focus-visible:underline"
          onClick={() => onSelect(item)}
          type="button"
        >
          {message}
        </Button>
      )
    return <span className="diagnostic-message">{message}</span>
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
          {groups.map((group, groupIndex) =>
            group.nodeId == null ? (
              <li key={`issue:${groupIndex}`}>{issueContent(group.items[0]!)}</li>
            ) : (
              <li key={`node:${group.nodeId}`} className="diagnostics-node-group">
                <div className="diagnostics-node-header">
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto min-w-0 break-words p-0 text-left font-semibold"
                    onClick={() => onSelectNode(group.nodeId!)}
                  >
                    {nodes.get(group.nodeId)?.title}
                  </Button>
                  {group.items.length > 1 && <span>{t('diagnostics.summary', { count: group.items.length })}</span>}
                </div>
                <ol className="diagnostics-node-items">
                  {group.items.map((item, index) => (
                    <li key={`${item.diagnostic.path}:${item.diagnostic.code}:${index}`}>{issueContent(item)}</li>
                  ))}
                </ol>
              </li>
            ),
          )}
        </ol>
      )}
    </aside>
  )
}
