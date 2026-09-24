import type { ReactElement } from 'react'
import type { CanvasNodeIconData } from '../../../../canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import type { DiagnosticItem } from '../editor/diagnostics.ts'

import { useTranslate } from 'val-i18n-react'
import { CanvasNodeIcon } from '../../../../canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { diagnosticMessage, diagnosticNodeId } from '../editor/diagnostics.ts'
import { Icon } from '../icons.tsx'

interface Props {
  readonly checking: boolean
  readonly items: readonly DiagnosticItem[]
  readonly nodes: ReadonlyMap<string, CanvasNodeIconData & { readonly title: string }>
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onSelect: (item: DiagnosticItem) => void
  readonly onSelectNode: (nodeId: string) => void
}

export function DiagnosticsPanel({ checking, items, nodes, onClose, onRefresh, onSelect, onSelectNode }: Props): ReactElement {
  const t = useTranslate()
  const groups = new Map<string, DiagnosticItem[]>()
  const otherItems: DiagnosticItem[] = []
  for (const item of items) {
    const nodeId = item.location?.nodeId
    if (nodeId == null || !nodes.has(nodeId)) {
      otherItems.push(item)
      continue
    }
    const group = groups.get(nodeId) ?? []
    group.push(item)
    groups.set(nodeId, group)
  }

  function issueContent(item: DiagnosticItem): ReactElement {
    const message =
      item.message ??
      diagnosticMessage(item.diagnostic, t, (nodeId) => nodes.get(nodeId)?.title, item.location == null ? undefined : nodes.get(item.location.nodeId)?.title)
    const referencedNodeId = diagnosticNodeId(item.diagnostic)
    const navigate =
      item.location != null ? () => onSelect(item) : referencedNodeId != null && nodes.has(referencedNodeId) ? () => onSelectNode(referencedNodeId) : undefined
    if (navigate == null) return <span className="diagnostic-message">{message}</span>
    return (
      <Button
        aria-label={t('diagnostics.locateIssue', { message })}
        className="diagnostic-message diagnostic-message-link"
        onClick={navigate}
        size="sm"
        type="button"
        variant="ghost"
      >
        <span>{message}</span>
        <i aria-hidden="true" className="i-lucide-light:arrow-up-right" />
      </Button>
    )
  }

  return (
    <section aria-busy={checking} className="diagnostics-panel" id="diagnostics-panel">
      <header className="diagnostics-panel-header">
        <div className="diagnostics-panel-heading">
          <strong>{t('diagnostics.title')}</strong>
          {checking && <span aria-live="polite">{t('diagnostics.checking')}</span>}
        </div>
        <div className="diagnostics-panel-actions">
          <Button
            aria-label={t('diagnostics.refresh')}
            disabled={checking}
            onClick={onRefresh}
            size="icon-sm"
            title={t('diagnostics.refresh')}
            type="button"
            variant="ghost"
          >
            <Icon name="refresh" />
          </Button>
          <Button aria-label={t('diagnostics.close')} onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <Icon name="close" />
          </Button>
        </div>
      </header>
      <div className="diagnostics-panel-list">
        {groups.size > 0 && (
          <ol className="diagnostics-node-list">
            {[...groups].map(([nodeId, nodeItems]) => {
              const node = nodes.get(nodeId)!
              const title = node.title
              return (
                <li className="diagnostics-node-group" key={nodeId}>
                  <Button
                    aria-label={`${t('run.locateNode', { name: title })} · ${nodeItems.length == 1 ? t('workspace.issueSingle') : t('diagnostics.summary', { count: nodeItems.length })}`}
                    className="diagnostics-node-target"
                    onClick={() => onSelectNode(nodeId)}
                    type="button"
                    variant="ghost"
                  >
                    <span aria-hidden="true" className="diagnostics-node-icon">
                      <CanvasNodeIcon icon={node.icon} kind={node.kind} className="size-[18px]" />
                    </span>
                    <span className="diagnostics-node-title">{title}</span>
                    <span aria-hidden="true" className="diagnostics-node-trailing">
                      <span className="diagnostics-node-count">{nodeItems.length}</span>
                      <i className="diagnostics-node-locate i-lucide-light:locate" />
                    </span>
                  </Button>
                  <ol className="diagnostics-node-items">
                    {nodeItems.map((item, index) => (
                      <li key={`${item.diagnostic.path}:${item.diagnostic.code}:${index}`}>{issueContent(item)}</li>
                    ))}
                  </ol>
                </li>
              )
            })}
          </ol>
        )}
        {otherItems.length > 0 && (
          <section className="diagnostics-other-issues">
            <h3>{t('diagnostics.otherIssues')}</h3>
            <ol>
              {otherItems.map((item, index) => (
                <li key={`${item.diagnostic.path}:${item.diagnostic.code}:${index}`}>{issueContent(item)}</li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </section>
  )
}
