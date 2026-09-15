import type { ReactElement } from 'react'
import type { FlowCanvasViewNode } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'

import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Icon } from '../icons.tsx'

interface FlowNodeListProps {
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
  const locateLabel = t('inspector.locateNode', { name: node.title })
  return (
    <div className="group/row flex min-w-0 items-center rounded-lg hover:bg-accent focus-within:bg-accent">
      <Button
        className="h-auto min-w-0 flex-1 justify-start gap-2.5 rounded-lg bg-transparent px-2.5 py-2 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
        onClick={() => onSelect(node.id)}
        type="button"
        variant="ghost"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-lg [&>svg]:size-[18px]">
          <ContentIcon className="size-[18px]" fallback={fallbackIcon(node)} src={'icon' in node ? node.icon : undefined} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{node.title}</span>
      </Button>
      <Button
        aria-label={locateLabel}
        className="mr-1 opacity-0 hover:bg-transparent focus-visible:opacity-100 group-hover/row:opacity-100 dark:hover:bg-transparent"
        onClick={() => onFocusNode(node.id)}
        size="icon-sm"
        title={locateLabel}
        type="button"
        variant="ghost"
      >
        <Icon name="fit" />
      </Button>
    </div>
  )
}

export function FlowNodeList({ nodes, onFocusNode, onSelect }: FlowNodeListProps): ReactElement {
  const t = useTranslate()
  return (
    <ScrollArea className="h-full" autoHide="never" defer={false} tabIndex={-1}>
      {nodes.length == 0 ? (
        <div className="inspector-empty">{t('designer.emptyTitle', { kind: t('common.flow') })}</div>
      ) : (
        <div className="grid px-2 py-3">
          {nodes.map((node) => (
            <FlowNodeRow key={node.id} node={node} onFocusNode={onFocusNode} onSelect={onSelect} />
          ))}
        </div>
      )}
    </ScrollArea>
  )
}
