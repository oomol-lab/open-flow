import type { ReactElement } from 'react'
import type { CanvasNodeIconData } from '../../../../canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import type { DiagnosticItem } from '../editor/diagnostics.ts'

import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Icon } from '../icons.tsx'
import { DiagnosticsPanel } from './diagnosticsPanel.tsx'

interface Props {
  readonly checking: boolean
  readonly items: readonly DiagnosticItem[]
  readonly nodes: ReadonlyMap<string, CanvasNodeIconData & { readonly title: string }>
  readonly onOpenChange: (open: boolean) => void
  readonly onRefresh: () => void
  readonly onSelect: (item: DiagnosticItem) => void
  readonly onSelectNode: (nodeId: string) => void
  readonly open: boolean
}

export function WorkspaceDiagnosticsIsland({ checking, items, nodes, onOpenChange, onRefresh, onSelect, onSelectNode, open }: Props): ReactElement | null {
  const t = useTranslate()
  const [popupContainer, setPopupContainer] = useState<HTMLElement | null>(null)
  const mount = useCallback((element: HTMLDivElement | null) => setPopupContainer(element?.closest<HTMLElement>('.canvas-panel') ?? element), [])
  if (items.length == 0) return null

  return (
    <div
      className="open-flow-control-island open-flow-control-island-compact open-flow-control-island-soft-shadow workspace-diagnostics-island"
      data-tooltip-toolbar
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={mount}
    >
      <Popover open={popupContainer != null && open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          aria-controls="diagnostics-panel"
          aria-label={`${t('diagnostics.open')} · ${t('diagnostics.summary', { count: items.length })}`}
          render={<Button size="default" type="button" variant="ghost" />}
        >
          <Icon data-icon="inline-start" name="alert" />
          {items.length == 1 ? t('workspace.issueSingle') : t('workspace.issues', { count: items.length })}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="diagnostics-popover nodrag nopan"
          container={popupContainer}
          side="bottom"
          sideOffset={8}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <PopoverTitle className="sr-only">{t('diagnostics.title')}</PopoverTitle>
          <DiagnosticsPanel
            checking={checking}
            items={items}
            nodes={nodes}
            onClose={() => onOpenChange(false)}
            onRefresh={onRefresh}
            onSelect={onSelect}
            onSelectNode={onSelectNode}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
