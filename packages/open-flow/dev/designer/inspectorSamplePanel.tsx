import type { ReactNode } from 'react'
import type { WorkbenchTheme } from '../../src/workbench/browser/runtime/contract.ts'
import type { ResolvedSelection, RevisionView } from '../../src/workbench/browser/runtime/revisionView.ts'
import type { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { nodeNameIssue } from '../../src/flow/common/change.ts'
import { Button } from '../../src/ui/browser/button.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { inspectorIcon } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { Icon } from '../../src/workbench/browser/runtime/icons.tsx'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'

export function InspectorSamplePanel({
  children,
  disabled,
  revision,
  selection,
  store,
  theme,
  onClose,
  resizable,
}: {
  onClose?: () => void
  resizable?: boolean
  children: ReactNode
  disabled: boolean
  revision: RevisionView
  selection: ResolvedSelection | undefined
  store: WorkspaceStore
  theme: WorkbenchTheme
}) {
  const [open, setOpen] = useState(true)
  const [ignored, setIgnored] = useState(false)
  const t = useTranslate()
  const target = { kind: 'flow' } as const
  const icon = inspectorIcon(selection, target)
  const canvasNode = designerGraph(revision.revision, target, undefined, [], {}, {}, t).nodes.find((node) => node.id === selection?.id)
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Reopen properties
      </Button>
    )
  return (
    <EditorContextPanel
      nodeId={selection?.id}
      title={selection?.node.name ?? t('inspector.title')}
      icon={icon}
      theme={theme}
      focusOnOpen={false}
      onClose={onClose ?? (() => setOpen(false))}
      resizable={resizable}
      nodeHeading={
        selection && {
          title: selection.node.name ?? '',
          icon: canvasNode && 'icon' in canvasNode ? canvasNode.icon : selection.node.icon,
          disabled,
          titleReadOnly: selection.kind === 'trigger' && selection.trigger.kind === 'manual',
          fallback: <Icon name={icon} />,
          validate: (name) => {
            const graph = revision.graph(target)
            if (!graph) return
            const issue = nodeNameIssue(graph, selection.id, name)
            return issue == null ? undefined : t(`inspector.node.${issue === 'empty' ? 'nameEmpty' : 'nameDuplicate'}`)
          },
          onRename: (name) => {
            void store.saveNodeTitle(selection.id, name)
          },
          onIconChange: (value) => {
            void store.saveNodeIcon(selection.id, value)
          },
        }
      }
      nodeActions={
        selection && {
          ignored,
          onIgnore: setIgnored,
          onDuplicate:
            selection.kind === 'trigger'
              ? undefined
              : () => {
                  store.selectNodes([selection.id])
                  void store.duplicateSelectedNodes()
                },
          onDelete: disabled
            ? undefined
            : () => {
                store.selectNodes([selection.id])
                void store.deleteSelectedNodes()
              },
        }
      }
    >
      {children}
    </EditorContextPanel>
  )
}
