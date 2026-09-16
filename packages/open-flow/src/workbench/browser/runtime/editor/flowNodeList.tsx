import type { ReactElement } from 'react'
import type { FlowCanvasViewNode } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'

interface FlowNodeListProps {
  readonly groupTriggers?: boolean
  readonly onAdd?: () => void
  readonly nodes: readonly FlowCanvasViewNode[]
  readonly onFocusNode: (nodeId: string) => void
  readonly onSelect: (nodeId: string) => void
}

function fallbackIcon(node: FlowCanvasViewNode): ReactElement {
  if (node.kind == 'comment') return <i aria-hidden="true" className="i-codicon:note" />
  return <Icon name={node.kind} />
}

function FlowNodeRow({
  node,
  onFocusNode,
  onSelect,
}: { readonly node: FlowCanvasViewNode } & Pick<FlowNodeListProps, 'onFocusNode' | 'onSelect'>): ReactElement {
  const t = useTranslate()
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null)
  const locateLabel = t('inspector.locateNode')
  return (
    <div ref={setTooltipContainer} className="flex min-w-0 items-center rounded-lg hover:bg-accent focus-within:bg-accent">
      <Button
        className="h-auto min-w-0 flex-1 justify-start gap-2.5 rounded-lg bg-transparent px-2.5 py-2 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
        onClick={() => onSelect(node.id)}
        type="button"
        variant="ghost"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-foreground/5 text-lg has-[>img]:border has-[>img]:bg-background has-[>[data-icon-kind=initials]]:border has-[>[data-icon-kind=initials]]:bg-background border-foreground/10 [--content-icon-initials-background:transparent] [&>svg]:size-[18px]">
          <ContentIcon className="size-[18px]" fallback={fallbackIcon(node)} src={'icon' in node ? node.icon : undefined} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{node.title}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={locateLabel}
              className="mr-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground dark:hover:bg-foreground/10"
              onClick={() => onFocusNode(node.id)}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Icon name="fit" />
        </TooltipTrigger>
        <TooltipContent container={tooltipContainer} side="top" align="end">
          {locateLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function FlowNodeGrid({ nodes, onFocusNode, onSelect }: Omit<FlowNodeListProps, 'groupTriggers' | 'onAdd'>): ReactElement {
  return (
    <div className="flow-node-list-grid">
      {nodes.map((node) => (
        <FlowNodeRow key={node.id} node={node} onFocusNode={onFocusNode} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function FlowNodeList({ nodes, onFocusNode, onSelect, onAdd, groupTriggers = false }: FlowNodeListProps): ReactElement {
  const t = useTranslate()
  const triggers = groupTriggers ? nodes.filter((node) => node.kind == 'trigger') : []
  const otherNodes = groupTriggers ? nodes.filter((node) => node.kind != 'trigger') : nodes
  return (
    <ScrollArea className="h-full" autoHide="never" defer={false} tabIndex={-1}>
      {nodes.length == 0 ? (
        <div className="inspector-empty flex flex-col items-center gap-3">
          <span>{t('inspector.emptyOutline')}</span>
          {onAdd && (
            <Button onClick={onAdd} variant="outline">
              {t('designer.addNode')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 px-2 py-3">
          {triggers.length > 0 && (
            <section>
              <h3 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t('inspector.triggers')}</h3>
              <FlowNodeGrid nodes={triggers} onFocusNode={onFocusNode} onSelect={onSelect} />
            </section>
          )}
          {otherNodes.length > 0 && (
            <section>
              {groupTriggers && <h3 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t('inspector.nodes')}</h3>}
              <FlowNodeGrid nodes={otherNodes} onFocusNode={onFocusNode} onSelect={onSelect} />
            </section>
          )}
        </div>
      )}
    </ScrollArea>
  )
}
