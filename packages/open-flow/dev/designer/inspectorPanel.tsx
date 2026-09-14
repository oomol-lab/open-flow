import type { FlowCanvasViewNodeRun } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { ContextPanel } from '../../src/workbench/browser/runtime/editor/contextPanel.tsx'
import { NodeDescription } from '../../src/workbench/browser/runtime/editor/nodeDescription.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const success: FlowCanvasViewNodeRun = {
  runId: 'run_sample_20260914',
  status: 'success',
  finishedAt: '2026-09-14T02:30:00Z',
  outputs: { summary: 'Three issues need review.', issues: [{ id: 'FLOW-42', title: 'Review sidebar', labels: ['design', 'workflow'] }], count: 3 },
}
function CanvasSample({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const [selected, setSelected] = useState<readonly string[]>(['review'])
  const [open, setOpen] = useState(true)
  const [description, setDescription] = useState<string | undefined>('Fetch the issues that need review.')
  useStoryActions([{ label: open ? 'Close properties' : 'Open properties', onClick: () => setOpen(!open) }])
  return (
    <div className={`editor-grid col-span-full h-[480px] overflow-hidden rounded-lg border border-border ${open ? '' : 'context-panel-closed'}`}>
      <FlowCanvasView
        identity="inspector-tab-example"
        editable={false}
        dark={dark}
        language={language}
        model={{
          nodes: [
            { id: 'review', kind: 'task', reference: 'lab/review', title: 'Review issues', inputs: [], outputs: [], position: { x: 60, y: 100 }, run: success },
          ],
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
        <ContextPanel resizable icon="task" title="Review issues" theme={dark ? 'dark' : 'light'} focusOnOpen={false} onClose={() => setOpen(false)}>
          <NodeDescription value={description} disabled={false} onSave={setDescription} />
        </ContextPanel>
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
  description: 'Toggle properties to inspect the smooth canvas resize; drag the divider to resize directly. Run results remain in the canvas card popover.',
  render: (_log, dark, language) => <Gallery dark={dark} language={language} />,
}
