import type { FlowCanvasViewProps } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { Draft, Presentation } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { RevisionCanvasSession } from './revisionCanvasSession.ts'

import { useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { FlowCanvasView } from '../../../../canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { revisionView } from '../revisionView.ts'
import { designerGraph } from '../workspace.ts'
import { CommentInspector } from './commentInspector.tsx'
import { ContextPanel } from './contextPanel.tsx'
import { FlowNodeList } from './flowNodeList.tsx'
import { inspectorIcon, NodeInspector } from './nodeInspector.tsx'
import { changeRevisionCanvasSession } from './revisionCanvasSession.ts'
import { WorkbenchInspectorToggle } from './workbenchInspectorToggle.tsx'

/** The parent keys this session by snapshot identity. All movement is disposable view state. */

export function RevisionCanvas({
  draft,
  presentation,
  theme,
  interactiveMode$,
  label,
  background = 'striped',
  showHeader = true,
}: {
  readonly label?: string
  readonly background?: 'dotted' | 'striped'
  readonly showHeader?: boolean
  readonly draft: Draft
  readonly presentation: Presentation | null
  readonly theme: WorkbenchTheme
  readonly interactiveMode$?: FlowCanvasViewProps['interactiveMode$']
}) {
  const root = useRef<HTMLElement>(null)
  const t = useTranslate()
  const language = useLang()
  const revision = useMemo(() => revisionView(draft), [draft])
  const graphId = 'flow'
  const [sessions, setSessions] = useState<RevisionCanvasSession>({})
  const [selected, setSelected] = useState<readonly string[]>([])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [focus, setFocus] = useState<FlowCanvasViewProps['focusNodeRequest']>()
  const baseline = useMemo(() => designerGraph(draft, presentation?.value, [], {}, {}, t), [draft, presentation, t])
  const session = sessions[graphId]
  const model = useMemo(
    () => ({
      ...baseline,
      viewport: session?.viewport ?? baseline.viewport,
      nodes: baseline.nodes.map((node) => ({ ...node, position: session?.positions?.[node.id] ?? node.position })),
    }),
    [baseline, session],
  )
  const moved = baseline.nodes.some((node) => {
    const position = session?.positions?.[node.id]
    return position != null && (position.x !== node.position.x || position.y !== node.position.y)
  })

  const selection = selected.length === 1 ? revision.node(selected[0]!) : undefined
  const comment = selected.length === 1 ? model.nodes.find((node) => node.id === selected[0] && node.kind === 'comment') : undefined
  const navigation =
    presentation == null || moved ? (
      <>
        {presentation == null && <span className="revision-viewer-hint">{t('snapshot.missingLayout')}</span>}
        {moved && (
          <Button
            className="ml-auto"
            size="xs"
            variant="ghost"
            onClick={() => setSessions((current) => changeRevisionCanvasSession(current, graphId, { kind: 'restore' }))}
          >
            <i aria-hidden="true" className="i-lucide-light:rotate-ccw" />
            {t('snapshot.restore')}
          </Button>
        )}
      </>
    ) : undefined
  return (
    <section ref={root} className={`revision-viewer${inspectorOpen ? ' inspector-open' : ''}`} aria-label={label ?? t('snapshot.title')}>
      {showHeader && (
        <header className="revision-viewer-toolbar">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <i aria-hidden="true" className="i-lucide-light:lock-keyhole" />
            {label ?? t('snapshot.title')}
          </span>
          {navigation}
        </header>
      )}
      <div className="revision-viewer-body">
        <div className="revision-viewer-canvas">
          <FlowCanvasView
            key={graphId}
            identity={graphId}
            model={model}
            editable={false}
            dottedBackground={background === 'dotted'}
            nodesDraggable
            fitView={session?.viewport == null}
            className={background === 'striped' ? 'open-flow-canvas-locked' : undefined}
            dark={theme === 'dark'}
            language={language}
            interactiveMode$={interactiveMode$}
            selectedNodeIds={selected}
            ignoredNodeIds={[]}
            focusNodeRequest={focus}
            onMoveNodes={(positions) => setSessions((current) => changeRevisionCanvasSession(current, graphId, { kind: 'move', positions }))}
            onMoveViewport={(viewport) => setSessions((current) => changeRevisionCanvasSession(current, graphId, { kind: 'viewport', viewport }))}
            onSelectionChange={setSelected}
            onInspectSelection={() => setInspectorOpen((open) => !open)}
            inspectorOpen={inspectorOpen}
            toolbar={showHeader ? undefined : navigation}
            cornerTools={
              <WorkbenchInspectorToggle
                label={t('designer.toggleInspector')}
                open={inspectorOpen}
                disabled={false}
                onToggle={() => setInspectorOpen((open) => !open)}
              />
            }
          />
          {model.nodes.length === 0 && <p className="revision-viewer-empty">{t('inspector.emptyOutline')}</p>}
        </div>
        {inspectorOpen && (
          <ContextPanel
            layoutRoot={root}
            className="open-flow-property-panel"
            theme={theme}
            title={selection?.node.name ?? comment?.title ?? t('inspector.title')}
            icon={comment?.kind === 'comment' ? 'comment' : inspectorIcon(selection)}
            focusOnOpen
            onClose={() => setInspectorOpen(false)}
          >
            {selection != null ? (
              <NodeInspector readOnly key={`${graphId}:${selection.id}`} revision={revision} selection={selection} theme={theme} />
            ) : comment?.kind === 'comment' ? (
              <CommentInspector key={comment.id} title={comment.title} content={comment.content ?? ''} dark={theme === 'dark'} readOnly />
            ) : (
              <FlowNodeList
                nodes={selected.length > 1 ? model.nodes.filter((node) => selected.includes(node.id)) : model.nodes}
                onSelect={(id) => setSelected([id])}
                onFocusNode={(nodeId) => {
                  setSelected([nodeId])
                  setFocus({ nodeId, requestId: (focus?.requestId ?? 0) + 1 })
                }}
              />
            )}
          </ContextPanel>
        )}
      </div>
    </section>
  )
}
