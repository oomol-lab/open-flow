import type { ComponentProps } from 'react'

import { ContextPanel } from './contextPanel.tsx'
import { NodeHeading } from './nodeHeading.tsx'

// Workbench and Lab use the same panel header and container.
export function EditorContextPanel({
  className,
  nodeId,
  nodeHeading,
  ...props
}: Omit<ComponentProps<typeof ContextPanel>, 'heading' | 'actions'> & {
  readonly nodeId?: string
  readonly nodeHeading?: ComponentProps<typeof NodeHeading>
}) {
  return (
    <ContextPanel
      {...props}
      className={['editor-context-panel', className].filter(Boolean).join(' ')}
      heading={nodeHeading && <NodeHeading key={nodeId} {...nodeHeading} />}
    />
  )
}
