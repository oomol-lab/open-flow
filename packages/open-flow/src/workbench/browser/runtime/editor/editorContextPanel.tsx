import type { ComponentProps } from 'react'

import { NodeActions } from '../../../../canvas/browser/nodeActions.tsx'
import { ContextPanel } from './contextPanel.tsx'
import { NodeHeading } from './nodeHeading.tsx'

// Workbench and Lab use the same panel header, node menu and container.
export function EditorContextPanel({
  className,
  nodeId,
  nodeHeading,
  nodeActions,
  ...props
}: Omit<ComponentProps<typeof ContextPanel>, 'heading' | 'actions'> & {
  readonly nodeId?: string
  readonly nodeHeading?: ComponentProps<typeof NodeHeading>
  readonly nodeActions?: ComponentProps<typeof NodeActions>
}) {
  return (
    <ContextPanel
      {...props}
      className={['editor-context-panel', className].filter(Boolean).join(' ')}
      heading={nodeHeading && <NodeHeading key={nodeId} {...nodeHeading} />}
      actions={nodeActions && <NodeActions {...nodeActions} />}
    />
  )
}
