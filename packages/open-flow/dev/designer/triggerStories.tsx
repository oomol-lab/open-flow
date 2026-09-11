import type { ReactNode } from 'react'
import type { FlowCanvasViewModel, FlowCanvasViewNodeRun } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { TriggerNode, TriggerSchedule } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DraftRun, TriggerBinding } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'
import type { TriggerFixture } from './triggerFixtures.ts'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../src/ui/browser/empty.tsx'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ListenerHealth, TriggerStatus } from '../../src/workbench/browser/runtime/publications/publicationsView.tsx'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'
import { RunInputPanel } from '../../src/workbench/browser/runtime/runs/runInputPanel.tsx'
import { RunRequestStore } from '../../src/workbench/browser/runtime/runs/runRequestStore.ts'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'
import { useStorySidebar } from './storySidebar.tsx'
import { triggerDraft, triggerFixtures } from './triggerFixtures.ts'
import { createTriggerSession } from './triggerSession.ts'

type StoryProps = {
  fixture: TriggerFixture
  dark: boolean
  language: UiLanguage
  log: LogAction
}
function Gallery({ children, dark, language }: { children: ReactNode; dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  return (
    <I18nProvider i18n={i18n}>
      <div className="trigger-gallery open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
        {children}
      </div>
    </I18nProvider>
  )
}

function NodeStory({ fixture, dark, language, log, active = true, onActivate }: StoryProps & { active?: boolean; onActivate?: () => void }) {
  const { trigger } = fixture
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(fixture.id)
  const [selected, setSelected] = useState<readonly string[]>(['selected'])
  const [hiddenContent, setHiddenContent] = useState<Readonly<Record<string, boolean>>>({})
  const { model: canvasModel, samples: triggerSamples } = useMemo(() => {
    const cases: readonly {
      id: string
      title: string
      status?: FlowCanvasViewNodeRun['status']
      diagnostics?: number
      description?: string
      schedules?: readonly TriggerSchedule[]
    }[] = [
      { id: 'idle', title: 'Idle' },
      { id: 'selected', title: 'Selected' },
      { id: 'unconfigured', title: 'Unconfigured', diagnostics: 1, schedules: [] },
      { id: 'waiting', title: 'Waiting', status: 'waiting' },
      { id: 'running', title: 'Running', status: 'running' },
      { id: 'success', title: 'Success', status: 'success' },
      { id: 'error', title: 'Error', status: 'error' },
      {
        id: 'long',
        title: `${trigger.name} · Orders received from all regional stores requiring manual review`,
        description: 'Inspect single-line title truncation and wrapping of this longer trigger description.',
      },
      {
        id: 'description',
        title: 'With description',
        description: trigger.description ?? 'Starts this workflow with a test event.',
      },
      ...(trigger.kind === 'cron'
        ? [
            { id: 'cron', title: 'Cron', schedules: [{ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }] as const },
            {
              id: 'readable',
              title: 'Readable schedules',
              schedules: ['0 9 * * 1-5', '*/15 * * * *', '0 9 L * *'].map((expression) => ({ type: 'cron' as const, expression, timezone: 'Asia/Shanghai' })),
            },
            {
              id: 'fallback',
              title: 'Original expressions',
              schedules: ['0 9 1 * MON', '0 9 * * 5#L', 'invalid'].map((expression) => ({
                type: 'cron' as const,
                expression,
                timezone: 'America/Argentina/Buenos_Aires',
              })),
            },
            {
              id: 'overflow',
              title: 'Long rule and timezone',
              schedules: [
                { type: 'cron' as const, expression: '0,5,10,15,20,25,30,35,40,45,50,55 9-17 * * MON-FRI', timezone: 'America/Argentina/ComodRivadavia' },
                { type: 'cron' as const, expression: '0,10,20,30,40,50 9,12,15,18 * * MON-FRI', timezone: 'Unknown/An exceptionally long timezone name' },
              ],
            },
            { id: 'multiple', title: 'Multiple schedules', description: 'Refresh regional reports.', schedules: trigger.cronTimes },
            {
              id: 'many',
              title: 'Many schedules',
              schedules: [9, 12, 15, 18, 21].map((hour) => ({ type: 'cron' as const, expression: `0 ${hour} * * *`, timezone: 'Asia/Shanghai' })),
            },
          ]
        : []),
    ]
    const samples = new Map<string, TriggerFixture>()
    const model: FlowCanvasViewModel = {
      edges: [],
      viewport: { x: 36, y: 60, zoom: 0.5 },
      nodes: cases.map((entry, index) => {
        let sample: TriggerNode = {
          ...trigger,
          name: entry.id === 'long' ? entry.title : `${entry.title} · ${trigger.name}`,
          description: entry.description,
        }
        if (sample.kind === 'cron') sample = { ...sample, cronTimes: entry.schedules ?? [{ type: 'every', unit: 'hour', value: 1 }] }
        else if (sample.kind === 'poll' && entry.schedules) sample = { ...sample, pollTimes: entry.schedules }
        if (entry.id === 'unconfigured') {
          if (sample.kind === 'poll' || sample.kind === 'integration') sample = { ...sample, config: {} }
          else if (sample.kind === 'webhook') sample = { ...sample, inputsDef: [], options: {} }
        }
        samples.set(entry.id, { id: `${fixture.id}-${entry.id}`, trigger: sample, payload: fixture.payload })
        const base = designerGraph(triggerDraft(sample).draft, { kind: 'flow' }).nodes.find((node) => node.kind === 'trigger')!
        return Object.assign({}, base, {
          id: entry.id,
          position: { x: (index % 3) * 420, y: Math.floor(index / 3) * (trigger.kind === 'cron' ? 320 : 210) },
          diagnostics: entry.diagnostics,
          run: entry.status
            ? {
                status: entry.status,
                error: entry.status === 'error' ? { message: 'Sample trigger failed' } : undefined,
                outputs: entry.status === 'success' ? { payload: fixture.payload } : undefined,
              }
            : undefined,
        })
      }),
    }
    return { model, samples }
  }, [fixture, trigger])
  const model = useMemo(
    () => ({ ...canvasModel, nodes: canvasModel.nodes.map((node) => ({ ...node, contentHidden: hiddenContent[`${fixture.id}:${node.id}`] ?? false })) }),
    [canvasModel, fixture.id, hiddenContent],
  )
  const inspected = selected.length === 1 ? triggerSamples.get(selected[0]!) : undefined
  const sidebar = useStorySidebar(
    !active ? null : inspected ? (
      <div className="trigger-node-properties">
        <Gallery dark={dark} language={language}>
          <SidebarSample key={inspected.id} fixture={inspected} dark={dark} language={language} log={log} state="display" framed={false} />
        </Gallery>
      </div>
    ) : (
      <Empty className="h-full rounded-none border-0">
        <EmptyHeader>
          <EmptyTitle>Select a node</EmptyTitle>
          <EmptyDescription>View its configuration in this sidebar.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ),
  )
  return (
    <div className="workflow-story">
      {sidebar}
      <div className="workflow-canvas">
        <FlowCanvasView
          identity={`lab:trigger:${fixture.id}`}
          model={model}
          onChangeNodeContentHidden={(nodeId, hidden) => {
            setHiddenContent((value) => ({ ...value, [`${fixture.id}:${nodeId}`]: hidden }))
            log('node.contentHidden', { nodeId, hidden })
          }}
          dark={dark}
          language={language}
          editable
          autoLayout={false}
          layoutMotion={false}
          addItems={[]}
          selectedNodeIds={active ? selected : []}
          ignoredNodeIds={ignoredNodeIds}
          onIgnoreNodes={onIgnoreNodes}
          onSelectionChange={(ids) => {
            setSelected(ids)
            if (ids.length > 0 || active) onActivate?.()
          }}
          onAddNode={() => undefined}
          onConnect={(value) => log('edge.connect', value)}
          onDisconnect={(value) => log('edge.disconnect', value)}
          onDeleteNodes={(value) => log('node.delete', value)}
          onDuplicate={(value) => log('node.duplicate', value)}
          onPaste={(value) => log('canvas.paste', value)}
          onMoveNodes={(value) => log('node.move', value)}
          onMoveViewport={(value) => log('canvas.move', value)}
        />
      </div>
    </div>
  )
}

type RunState = 'closed' | 'empty' | 'ready' | 'invalid' | 'starting' | 'direct' | 'disabled'
function RunSample({ fixture, dark, language, log, state, downstream = false }: StoryProps & { state: RunState; downstream?: boolean }) {
  const [resource, setResource] = useState<{
    store: RunRequestStore
    inputs: ReturnType<typeof triggerDraft>
  }>()
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const { flow, draft } = triggerDraft(fixture.trigger, downstream)
    const i18n = createI18n(language)
    let release: (() => void) | undefined
    const requestRun = async (): Promise<DraftRun> => {
      logRef.current('run.start', fixture.id)
      if (state === 'starting')
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return {
        createdAt: flow.createdAt,
        flowId: flow.flowId,
        revisionId: draft.revisionId,
        runId: 'lab-run',
        source: 'draft',
        status: 'running',
        version: 1,
        closureDigest: 'lab',
        engineContract: 'open-flow-engine/v2',
        engineDigest: 'lab',
        modelVersion: 1,
        revisionDigest: draft.digest,
      }
    }
    const store = new RunRequestStore(
      {
        createDraftRun: requestRun,
        createLiveRun: async () => {
          throw new Error('No live Lab flow')
        },
        getLive: async () => {
          throw new Error('No live Lab flow')
        },
        getRevision: async () => draft,
      },
      { follow: () => true, prepareStart: () => () => true },
      (notice) => logRef.current('run.notice', notice),
      async () => draft.revisionId,
      i18n,
    )
    let disposed = false
    void (async () => {
      if (state !== 'closed' && state !== 'direct' && state !== 'disabled') {
        await store.editDraft(flow, draft, 'trigger')
        if (disposed) return
        for (const group of state === 'empty' ? [] : (store.$.inputRequest.value?.groups ?? [])) {
          group.editor.replaceValues(
            group.nodeId === 'trigger' ? { payload: state === 'invalid' ? null : fixture.payload } : { message: state === 'invalid' ? 123 : 'Test message' },
          )
        }
        if (state === 'invalid' || state === 'starting') void store.confirmInputs()
      }
      if (!disposed) setResource({ store, inputs: { flow, draft } })
    })()
    return () => {
      disposed = true
      store.dispose()
      release?.()
      i18n.dispose()
    }
  }, [fixture, language, state, downstream])
  const starting = useVal(resource?.store.$.starting) ?? false
  const request = useVal(resource?.store.$.inputRequest)
  const valid = useVal(request?.valid)
  return (
    <section className="trigger-case">
      <h3>
        {downstream ? 'Downstream input · ' : ''}
        {state}
      </h3>
      {resource && request && state !== 'closed' && (
        <div className="run-input-popover trigger-run-panel">
          <RunInputPanel store={resource.store} theme={dark ? 'dark' : 'light'} onStarted={() => log('run.started')} />
        </div>
      )}
      <div className="trigger-run-dock">
        <RunControl
          inputContent={
            state === 'closed' && resource ? (
              <RunInputPanel store={resource.store} theme={dark ? 'dark' : 'light'} onStarted={() => log('run.started')} />
            ) : undefined
          }
          disabled={state === 'disabled'}
          inputOpen={request != null}
          inputStatus={
            request ? (valid ? 'ready' : 'missing') : (resource?.store.inputStatus(resource.inputs.flow.flowId, resource.inputs.draft, 'trigger') ?? 'none')
          }
          onInputOpenChange={(open) => {
            // Gallery panels stay visible; the closed sample exercises the real popover.
            if (!open && state === 'closed') resource?.store.dismissInputs()
            if (open && resource) void resource.store.editDraft(resource.inputs.flow, resource.inputs.draft, 'trigger')
          }}
          onRun={() => {
            if (request) void resource?.store.confirmInputs()
            else if (resource) void resource.store.requestDraft(resource.inputs.flow, resource.inputs.draft, 'trigger')
          }}
          onSelectTrigger={() => {}}
          selectedTriggerId="trigger"
          starting={starting}
          triggers={[{ id: 'trigger', title: fixture.trigger.name }]}
        />
      </div>
    </section>
  )
}
function RunStory(props: StoryProps) {
  const direct = props.fixture.trigger.kind === 'manual' || props.fixture.trigger.kind === 'cron'
  return (
    <Gallery {...props}>
      <div className="trigger-case-grid">
        {direct && <RunSample {...props} state="direct" />}
        {(['empty', 'ready', 'invalid', 'starting'] as const).map((state) => (
          <RunSample key={state} {...props} state={state} downstream={direct} />
        ))}
        <RunSample {...props} state="closed" downstream={direct} />
        <RunSample {...props} state="disabled" />
      </div>
    </Gallery>
  )
}

type SidebarState = 'display' | 'edit' | 'unconfigured' | 'connection-error' | 'description'
function SidebarSample({ fixture, dark, language, log, state, framed = true }: StoryProps & { state: SidebarState; framed?: boolean }) {
  const [session, setSession] = useState<ReturnType<typeof createTriggerSession>>()
  const sidebar = useRef<HTMLElement>(null)
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    let trigger: TriggerNode = fixture.trigger
    if (state === 'description')
      trigger = {
        ...trigger,
        description:
          'Start the workflow manually to inspect a complete sample execution. This longer description exercises the sidebar’s text wrapping and editing.',
      }
    if (state === 'unconfigured') {
      if (trigger.kind === 'poll' || trigger.kind === 'integration') trigger = { ...trigger, config: {} }
      else if (trigger.kind === 'cron') trigger = { ...trigger, cronTimes: [] }
      else if (trigger.kind === 'webhook') trigger = { ...trigger, inputsDef: [], options: {} }
    }
    const next = createTriggerSession(trigger, language, (name, value) => logRef.current(name, value), `trigger-${fixture.id}-${state}`)
    setSession(next)
    void next.workspace.start('trigger-lab')
    return () => next.dispose()
  }, [fixture, language, state])
  const revision = useVal(session?.workspace.$.revision)
  const selection = revision?.selection({ kind: 'flow' }, `trigger-${fixture.id}-${state}`)
  useEffect(() => {
    // Open the production disclosure for simultaneous visual inspection, without changing its contents.
    if (fixture.trigger.kind === 'webhook') {
      for (const details of sidebar.current?.querySelectorAll<HTMLDetailsElement>('[data-inspector-section="trigger"] > [data-slot="field-group"] > details') ??
        [])
        details.open = true
    }
  }, [revision, fixture])
  return (
    <section className="trigger-case">
      {framed && <h3>{state.replaceAll('-', ' ')}</h3>}
      <aside className={framed ? 'trigger-sidebar inspector' : 'trigger-sidebar-content inspector'} ref={sidebar}>
        <header className="trigger-sidebar-heading">
          <strong>{fixture.trigger.name}</strong>
        </header>
        {session && revision && (
          <NodeInspector
            variables={{
              enabled: false,
              loaded: true,
              loading: false,
              names: [],
              onOpen: () => {},
            }}
            connectorAuthorizationPending={false}
            connectorLoading={false}
            connectors={session.connectors}
            diagnostics={[]}
            disabled={state === 'display'}
            onChooseWaitNotification={() => {}}
            revision={revision}
            selection={selection}
            store={session.workspace}
            theme={dark ? 'dark' : 'light'}
            target={{ kind: 'flow' }}
            triggerActiveConnections={state === 'unconfigured' ? [] : [session.account]}
            triggerAuthorizationPending={false}
            triggerConnection={state === 'unconfigured' ? undefined : session.account}
            triggerConnectionError={state === 'connection-error' ? 'Unable to load accounts. Sample network failure.' : undefined}
            triggerConnectionLoading={false}
            triggers={session.triggers}
          />
        )}
      </aside>
    </section>
  )
}
function SidebarStory(props: StoryProps) {
  const provider = props.fixture.trigger.kind === 'poll' || props.fixture.trigger.kind === 'integration'
  const states: SidebarState[] = provider
    ? ['display', 'edit', 'unconfigured', 'connection-error']
    : ['display', 'edit', props.fixture.trigger.kind === 'manual' ? 'description' : 'unconfigured']
  return (
    <Gallery {...props}>
      <div className="trigger-case-grid">
        {states.map((state) => (
          <SidebarSample key={state} {...props} state={state} />
        ))}
      </div>
    </Gallery>
  )
}

const providerFixtures = triggerFixtures.filter(({ trigger }) => trigger.kind === 'integration' || trigger.kind === 'poll')
const integrationExample = providerFixtures.find(({ id }) => id === 'github-on-repo-event')!
const pollExample = providerFixtures.find(({ id }) => id === 'gmail-on-message-received')!
const nestedExample = providerFixtures.find(({ id }) => id === 'googledrive-changes-detected')!
type ProviderView = 'nodes' | 'run' | 'sidebar'

function ProviderStory({ view, ...props }: Omit<StoryProps, 'fixture'> & { readonly view: ProviderView }) {
  const [providerId, setProviderId] = useState(() => new URLSearchParams(location.search).get('provider') ?? '')
  const fixture = providerFixtures.find((entry) => entry.id === providerId)
  const [activeFixtureId, setActiveFixtureId] = useState(integrationExample.id)
  return (
    <div className="provider-story">
      <div className="provider-story-toolbar">
        <label>
          <span>Provider</span>
          <select
            aria-label="Provider"
            value={fixture?.id ?? ''}
            onChange={(event) => {
              const id = event.target.value
              setProviderId(id)
              const url = new URL(location.href)
              if (id) url.searchParams.set('provider', id)
              else url.searchParams.delete('provider')
              history.replaceState(null, '', url)
            }}
          >
            <option value="">Representative cases</option>
            {(['integration', 'poll'] as const).map((kind) => (
              <optgroup key={kind} label={kind === 'poll' ? 'Poll' : 'Integration'}>
                {providerFixtures
                  .filter((entry) => entry.trigger.kind === kind)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.trigger.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span>{fixture ? fixture.trigger.name : 'Integration, polling and schema boundaries'}</span>
      </div>
      <div className="provider-story-content" key={fixture?.id ?? 'representative'}>
        {fixture ? (
          view === 'nodes' ? (
            <NodeStory {...props} fixture={fixture} />
          ) : view === 'run' ? (
            <RunStory {...props} fixture={fixture} />
          ) : (
            <SidebarStory {...props} fixture={fixture} />
          )
        ) : view === 'nodes' ? (
          <div className="provider-node-cases">
            {[integrationExample, pollExample].map((entry) => (
              <section key={entry.id}>
                <NodeStory {...props} fixture={entry} active={activeFixtureId === entry.id} onActivate={() => setActiveFixtureId(entry.id)} />
              </section>
            ))}
          </div>
        ) : (
          <Gallery {...props}>
            <div className="trigger-case-grid">
              {view === 'run' ? (
                <>
                  <RunSample {...props} fixture={integrationExample} state="ready" />
                  <RunSample {...props} fixture={integrationExample} state="invalid" />
                  <RunSample {...props} fixture={pollExample} state="empty" />
                  <RunSample {...props} fixture={pollExample} state="ready" />
                  <RunSample {...props} fixture={nestedExample} state="ready" />
                  <RunSample {...props} fixture={integrationExample} state="starting" />
                </>
              ) : (
                <>
                  <SidebarSample {...props} fixture={integrationExample} state="edit" />
                  <SidebarSample {...props} fixture={pollExample} state="edit" />
                  <SidebarSample {...props} fixture={integrationExample} state="unconfigured" />
                  <SidebarSample {...props} fixture={pollExample} state="unconfigured" />
                  <SidebarSample {...props} fixture={integrationExample} state="connection-error" />
                  <SidebarSample {...props} fixture={pollExample} state="display" />
                </>
              )}
            </div>
          </Gallery>
        )}
      </div>
    </div>
  )
}

export const triggerStories: readonly FrontendStory[] = [
  {
    id: 'trigger-listener-health',
    group: 'Trigger Provider',
    title: 'Listener health',
    standalone: true,
    description: 'Listener summaries and independent notification / scan health. All states use production components.',
    render: (_log, dark, language) => (
      <Gallery dark={dark} language={language}>
        <div className="trigger-case-grid">
          {(
            [
              ['Healthy', 'healthy', 'healthy', 'active'],
              ['Notifications unavailable', 'failed', 'healthy', 'active'],
              ['Read failed', 'healthy', 'failed', 'active'],
              ['Authorization required', 'healthy', 'needs_reauth', 'active'],
              ['Paused', 'failed', 'healthy', 'paused'],
            ] as const
          ).map(([label, health, sourceHealth, operatorState]) => {
            const fixture = triggerFixtures.find((item) => item.trigger.kind == 'integration' && item.trigger.definition.key == 'github.watch_pull_request')!
            const binding: TriggerBinding = {
              flowId: 'lab',
              triggerNodeId: 'listener',
              health,
              listener: { health: sourceHealth },
              operatorState,
              runtimeVersion: 1,
              currentPublicationId: 'live',
              updatedAt: '2026-09-11T00:00:00Z',
              kind: 'integration',
              version: 1,
            }
            return (
              <section key={label} className="rounded-lg border p-4">
                <h3>{label}</h3>
                <TriggerSummary trigger={fixture.trigger} />
                <TriggerStatus binding={binding} />
                <ListenerHealth binding={binding} />
              </section>
            )
          })}
        </div>
      </Gallery>
    ),
  },
  ...triggerFixtures
    .filter(({ trigger }) => trigger.kind !== 'integration' && trigger.kind !== 'poll')
    .flatMap((fixture): FrontendStory[] => [
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-nodes`,
        title: 'Node states',
        description: `${fixture.trigger.name} · Node states, configuration and long content.`,
        standalone: true,
        render: (log, dark, language) => <NodeStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-run`,
        title: 'Run menu states',
        description: `${fixture.trigger.name} · Run panels shown side by side. Manual and scheduled triggers run directly; their input samples use a downstream node.`,
        standalone: true,
        render: (log, dark, language) => <RunStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-sidebar`,
        title: 'Sidebar display & edit',
        description: `${fixture.trigger.name} · Node properties in display and edit states. Changes stay in this Lab session.`,
        standalone: true,
        render: (log, dark, language) => <SidebarStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
    ]),
  ...(['nodes', 'run', 'sidebar'] as const).map(
    (view): FrontendStory => ({
      group: 'Trigger Provider',
      description:
        view === 'nodes'
          ? 'Provider trigger states and configuration.'
          : view === 'run'
            ? 'Provider payloads, validation and run states.'
            : 'Provider properties, account states and optional configuration.',
      id: `trigger-provider-${view}`,
      title: view === 'nodes' ? 'Node states' : view === 'run' ? 'Run menu states' : 'Sidebar display & edit',
      standalone: true,
      render: (log, dark, language) => <ProviderStory view={view} log={log} dark={dark} language={language} />,
    }),
  ),
]
