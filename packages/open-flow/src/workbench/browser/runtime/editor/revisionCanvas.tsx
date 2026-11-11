import type { AppCatalogResponse } from '@oomol-lab/resource-cache/oomol'
import type { FlowCanvasViewProps } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { CanvasDirection } from '../../../../canvas/common/direction.ts'
import type { TriggerDisplay } from '../../../../trigger/providers/localization.ts'
import type { ConnectorProvider, Draft, Presentation } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { RevisionCanvasChange, RevisionCanvasSession } from './revisionCanvasSession.ts'

import { loadJson } from '@oomol-lab/resource-cache'
import { decodeAppCatalogResponse, getAppCatalogCache } from '@oomol-lab/resource-cache/oomol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { FlowCanvasView } from '../../../../canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { CanvasNodeIcon } from '../../../../canvas/browser/graph/Nodes/components/CanvasNodeIcon.tsx'
import { canvasDirection } from '../../../../canvas/common/direction.ts'
import { resolveUiLanguage } from '../../../../localization/common/languages.ts'
import { localizeTrigger } from '../../../../trigger/providers/localization.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { revisionView } from '../revisionView.ts'
import { provider } from '../stores/proxyCatalog.ts'
import { designerGraph } from '../workspace.ts'
import { CommentInspector } from './commentInspector.tsx'
import { ContextPanel } from './contextPanel.tsx'
import { FlowNodeList } from './flowNodeList.tsx'
import { NodeInspector } from './nodeInspector.tsx'
import { changeRevisionCanvasSession } from './revisionCanvasSession.ts'
import { WorkbenchInspectorToggle } from './workbenchInspectorToggle.tsx'

/** The parent keys this session by snapshot identity. All movement is disposable view state. */

export function RevisionCanvas({
  draft,
  presentation,
  theme,
  interactiveMode$,
  defaultInteractiveMode,
  defaultDirection,
  defaultMiniMapExpanded,
  defaultInspectorOpen = false,
  defaultSelectedNodeIds,
  nodesDraggable = true,
  layoutMotion,
  label,
  background = 'striped',
  showHeader = true,
}: {
  readonly label?: string
  readonly background?: 'dotted' | 'striped' | 'none'
  readonly showHeader?: boolean
  readonly draft: Draft
  readonly presentation: Presentation | null
  readonly theme: WorkbenchTheme
  readonly interactiveMode$?: FlowCanvasViewProps['interactiveMode$']
  readonly defaultInteractiveMode?: FlowCanvasViewProps['defaultInteractiveMode']
  readonly defaultDirection?: FlowCanvasViewProps['defaultDirection']
  readonly defaultMiniMapExpanded?: FlowCanvasViewProps['defaultMiniMapExpanded']
  readonly defaultInspectorOpen?: boolean
  readonly defaultSelectedNodeIds?: readonly string[]
  readonly nodesDraggable?: FlowCanvasViewProps['nodesDraggable']
  readonly layoutMotion?: FlowCanvasViewProps['layoutMotion']
}) {
  const root = useRef<HTMLElement>(null)
  const t = useTranslate()
  const language = resolveUiLanguage([useLang()])
  const revision = useMemo(() => revisionView(draft), [draft])
  const graphId = 'flow'
  const [sessions, setSessions] = useState<RevisionCanvasSession>({})
  const [inspectorOpen, setInspectorOpen] = useState(defaultInspectorOpen)
  const [focus, setFocus] = useState<FlowCanvasViewProps['focusNodeRequest']>()
  const [catalog, setCatalog] = useState<{ language: string; providers: Readonly<Record<string, ConnectorProvider>> }>()
  const [triggerCopy, setTriggerCopy] = useState<{ revision: typeof revision; language: string; display: Readonly<Record<string, TriggerDisplay>> }>()
  useEffect(() => {
    const definitions = Object.values(revision.graph().nodes).flatMap((node) => (node.kind == 'integration' || node.kind == 'poll' ? [node.definition] : []))
    if (definitions.length === 0) return
    let active = true
    void Promise.all(definitions.map(async (definition) => [definition.key, await localizeTrigger(definition, language)] as const)).then(
      (entries) => {
        if (active) setTriggerCopy({ revision, language, display: Object.fromEntries(entries) })
      },
      (error) => {
        if (active) console.warn('Could not load Preview Trigger translations.', error)
      },
    )
    return () => {
      active = false
    }
  }, [revision, language])
  const triggerDisplays = triggerCopy?.revision === revision && triggerCopy.language === language ? triggerCopy.display : undefined
  const needsProviders = revision.connectorProviderIds.size > 0
  useEffect(() => {
    if (!needsProviders) return
    const controller = new AbortController()
    const cache = getAppCatalogCache({
      locale: language.toLowerCase(),
      schemaVersion: 1,
      maxAge: 300_000,
      decode: decodeAppCatalogResponse,
      load: ({ locale }, validation) =>
        loadJson(`https://connector.oomol.com/public/v1/apps?locale=${encodeURIComponent(locale)}`, validation, decodeAppCatalogResponse, {
          credentials: 'omit',
          signal: AbortSignal.timeout(15_000),
        }),
    })
    const publish = (response: AppCatalogResponse) => {
      if (controller.signal.aborted) return
      setCatalog({
        language,
        providers: Object.fromEntries(response.data.map((app) => [app.service, provider(app, response.meta.iconSprite)])),
      })
    }
    void (async () => {
      try {
        const cached = await cache.peek(undefined)
        if (cached) publish(cached.data)
        publish(await cache.get(undefined, { signal: controller.signal }))
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Could not load Preview Provider metadata.', error)
      }
    })()
    return () => controller.abort()
  }, [language, needsProviders])
  const providerMetadata = catalog?.language === language ? catalog.providers : undefined
  const baseline = useMemo(
    () => designerGraph(draft, presentation?.value, [], {}, {}, t, undefined, [], providerMetadata),
    [draft, presentation, t, providerMetadata],
  )
  const [selected, setSelected] = useState<readonly string[]>(() => {
    const ids = new Set(defaultSelectedNodeIds)
    return baseline.nodes.filter((node) => ids.has(node.id)).map((node) => node.id)
  })
  const session = sessions[graphId]
  const needsInitialLayout = baseline.needsLayout && session?.initialLayout == null
  const model = useMemo(
    () => ({
      ...baseline,
      direction: session?.direction ?? session?.initialLayout?.direction ?? baseline.direction,
      viewport: session?.viewport ?? baseline.viewport,
      nodes: baseline.nodes.map((node) => ({
        ...node,
        position: session?.positions?.[node.id] ?? session?.initialLayout?.positions[node.id] ?? node.position,
      })),
    }),
    [baseline, session],
  )
  const layoutChanged =
    model.direction !== (session?.initialLayout?.direction ?? baseline.direction) ||
    baseline.nodes.some((node) => {
      const position = session?.positions?.[node.id]
      const original = session?.initialLayout?.positions[node.id] ?? node.position
      return position != null && (position.x !== original.x || position.y !== original.y)
    })
  const changeLayout = (positions: Parameters<FlowCanvasViewProps['onMoveNodes']>[0], direction?: CanvasDirection) => {
    let change: RevisionCanvasChange
    if (needsInitialLayout) change = { kind: 'initialize', positions, direction: direction ?? canvasDirection(baseline.direction) }
    else if (direction == null) change = { kind: 'move', positions }
    else change = { kind: 'direction', positions, direction }
    setSessions((current) => changeRevisionCanvasSession(current, graphId, change))
  }

  const selection = selected.length === 1 ? revision.node(selected[0]!) : undefined
  const selectedNode = selected.length === 1 ? model.nodes.find((node) => node.id === selected[0]) : undefined
  const panelTitle = selectedNode?.title ?? (selected.length > 1 ? t('inspector.multipleSelected', { count: selected.length }) : t('inspector.outline'))
  const restoreLayout = layoutChanged ? (
    <Button
      className="ml-auto"
      size="xs"
      variant="ghost"
      onClick={() => setSessions((current) => changeRevisionCanvasSession(current, graphId, { kind: 'restore' }))}
    >
      <i aria-hidden="true" className="i-lucide-light:rotate-ccw" />
      {t('snapshot.restore')}
    </Button>
  ) : undefined
  return (
    <section ref={root} className={`revision-viewer${inspectorOpen ? ' inspector-open' : ''}`} aria-label={label ?? t('snapshot.title')}>
      {showHeader && (
        <header className="revision-viewer-toolbar">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <i aria-hidden="true" className="i-lucide-light:lock-keyhole" />
            {label ?? t('snapshot.title')}
          </span>
          {restoreLayout}
        </header>
      )}
      <div className="revision-viewer-body">
        <div className="revision-viewer-canvas">
          <FlowCanvasView
            autoLayout={needsInitialLayout}
            key={graphId}
            identity={graphId}
            model={model}
            editable={false}
            dottedBackground={background === 'dotted'}
            nodesDraggable={nodesDraggable}
            layoutMotion={layoutMotion}
            fitView={session?.viewport == null}
            className={background === 'striped' ? 'open-flow-canvas-locked' : undefined}
            dark={theme === 'dark'}
            language={language}
            interactiveMode$={interactiveMode$}
            defaultInteractiveMode={defaultInteractiveMode}
            defaultDirection={defaultDirection}
            defaultMiniMapExpanded={defaultMiniMapExpanded}
            selectedNodeIds={selected}
            ignoredNodeIds={[]}
            focusNodeRequest={focus}
            onMoveNodes={changeLayout}
            onChangeDirection={(direction, positions) => {
              changeLayout(positions, direction)
              return true
            }}
            onMoveViewport={(viewport) => setSessions((current) => changeRevisionCanvasSession(current, graphId, { kind: 'viewport', viewport }))}
            onSelectionChange={setSelected}
            onInspectSelection={() => setInspectorOpen((open) => !open)}
            inspectorOpen={inspectorOpen}
            toolbar={showHeader ? undefined : restoreLayout}
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
            title={panelTitle}
            icon={
              selectedNode == null ? (
                'flow'
              ) : selectedNode.kind === 'comment' ? (
                <i aria-hidden="true" className="i-codicon:note size-full" />
              ) : (
                <CanvasNodeIcon {...selectedNode} className="size-full" />
              )
            }
            focusOnOpen
            onClose={() => setInspectorOpen(false)}
          >
            {selection != null ? (
              <NodeInspector
                readOnly
                key={`${graphId}:${selection.id}`}
                revision={revision}
                selection={selection}
                theme={theme}
                connectorProviders={providerMetadata}
                triggerDisplays={triggerDisplays}
              />
            ) : selectedNode?.kind === 'comment' ? (
              <CommentInspector key={selectedNode.id} title={selectedNode.title} content={selectedNode.content ?? ''} dark={theme === 'dark'} readOnly />
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
