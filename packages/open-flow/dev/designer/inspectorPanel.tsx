import type { FlowCanvasViewNodeRun, FlowCanvasViewTaskNode } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { FlowNodeList } from '../../src/workbench/browser/runtime/editor/flowNodeList.tsx'
import { NodeDescription } from '../../src/workbench/browser/runtime/editor/nodeDescription.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { Icon } from '../../src/workbench/browser/runtime/icons.tsx'
import { useStoryActions } from './storyActions.tsx'

const success: FlowCanvasViewNodeRun = {
  runId: 'run_sample_20260914',
  status: 'success',
  finishedAt: '2026-09-14T02:30:00Z',
  outputs: { summary: 'Three issues need review.', issues: [{ id: 'FLOW-42', title: 'Review sidebar', labels: ['design', 'workflow'] }], count: 3 },
}
const reviewNode: FlowCanvasViewTaskNode = {
  icon: ':carbon:code:',
  id: 'review',
  kind: 'task',
  reference: 'lab/review',
  title: 'Review issues',
  inputs: [],
  outputs: [],
  position: { x: 60, y: 100 },
  run: success,
}
function CanvasSample({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const [selected, setSelected] = useState<readonly string[]>(['review'])
  const [open, setOpen] = useState(true)
  const [description, setDescription] = useState<string | undefined>(
    'Fetch the issues that need review, group them by priority, and include enough context for the reviewer to decide what needs attention.',
  )
  const nodeSelected = selected.length > 0
  const nodeHeading = nodeSelected
    ? {
        disabled: false,
        fallback: <Icon name="task" />,
        icon: reviewNode.icon,
        onIconChange: () => {},
        onRename: () => {},
        title: reviewNode.title,
        validate: () => undefined,
      }
    : undefined
  useStoryActions([{ label: open ? 'Close properties' : 'Open properties', onClick: () => setOpen(!open) }])
  return (
    <div className={`editor-grid col-span-full h-[480px] overflow-hidden rounded-lg border border-border ${open ? '' : 'context-panel-closed'}`}>
      <FlowCanvasView
        identity="inspector-tab-example"
        editable={false}
        dark={dark}
        language={language}
        model={{
          nodes: [reviewNode],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }}
        selectedNodeIds={selected}
        ignoredNodeIds={[]}
        onIgnoreNodes={() => {}}
        onAddNode={() => undefined}
        onConnect={() => {}}
        onDeleteNodes={() => {}}
        onDisconnect={() => {}}
        onDuplicate={() => {}}
        onMoveNodes={() => {}}
        onMoveViewport={() => {}}
        onCopy={() => {}}
        onPaste={() => {}}
        onSelectionChange={(ids) => {
          setSelected(ids)
          if (ids.length > 0) setOpen(true)
        }}
      />
      {open && (
        <EditorContextPanel
          resizable
          icon={nodeSelected ? 'task' : 'flow'}
          title={nodeSelected ? reviewNode.title : 'Properties'}
          theme={dark ? 'dark' : 'light'}
          focusOnOpen={false}
          nodeId={selected[0]}
          nodeHeading={nodeHeading}
          onClose={() => setOpen(false)}
        >
          {nodeSelected ? (
            <NodeDescription value={description} disabled={false} onSave={setDescription} />
          ) : (
            <FlowNodeList nodes={[reviewNode]} onFocusNode={(nodeId) => setSelected([nodeId])} onSelect={(nodeId) => setSelected([nodeId])} />
          )}
        </EditorContextPanel>
      )}
    </div>
  )
}

function Gallery({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme grid w-full grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-5 overflow-auto p-5"
        data-theme={dark ? 'dark' : 'light'}
      >
        <CanvasSample dark={dark} language={language} />
      </div>
    </I18nProvider>
  )
}

export const inspectorPanelStory: FrontendStory = {
  group: 'Workbench',
  id: 'inspector-panel',
  title: 'Properties Panel',
  standalone: true,
  description: 'Select or clear the node to compare matching panel headers; toggle properties or drag the divider to inspect resizing.',
  render: (_log, dark, language) => <Gallery dark={dark} language={language} />,
}
