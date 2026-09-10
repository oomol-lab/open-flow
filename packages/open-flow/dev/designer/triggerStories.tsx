import type { ReactNode } from 'react'
import type { FlowCanvasViewModel, FlowCanvasViewNodeRun } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { TriggerNode } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DraftRun } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'
import type { TriggerFixture } from './triggerFixtures.ts'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'
import { RunInputPanel } from '../../src/workbench/browser/runtime/runs/runInputPanel.tsx'
import { RunRequestStore } from '../../src/workbench/browser/runtime/runs/runRequestStore.ts'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'
import { triggerDraft, triggerFixtures } from './triggerFixtures.ts'
import { createTriggerSession } from './triggerSession.ts'

type StoryProps = { fixture: TriggerFixture; dark: boolean; language: UiLanguage; log: LogAction }
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

function NodeStory({ fixture, dark, language, log }: StoryProps) {
  const { trigger } = fixture
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(fixture.id)
  const [selected, setSelected] = useState<readonly string[]>(['selected'])
  const model = useMemo<FlowCanvasViewModel>(() => {
    const schedules = trigger.kind === 'cron' ? trigger.cronTimes : trigger.kind === 'poll' ? trigger.pollTimes : []
    const base = designerGraph(triggerDraft(trigger).draft, { kind: 'flow' }).nodes.find((node) => node.kind === 'trigger')!
    const source = base.kind === 'trigger' ? base.presentation?.source : undefined
    const cases: readonly { id: string; title: string; status?: FlowCanvasViewNodeRun['status']; diagnostics?: number; description?: string }[] = [
      { id: 'idle', title: 'Idle' },
      { id: 'selected', title: 'Selected' },
      { id: 'unconfigured', title: 'Unconfigured', diagnostics: 1 },
      { id: 'waiting', title: 'Waiting', status: 'waiting' },
      { id: 'running', title: 'Running', status: 'running' },
      { id: 'success', title: 'Success', status: 'success' },
      { id: 'error', title: 'Error', status: 'error' },
      {
        id: 'long',
        title: `${trigger.name} · Orders received from all regional stores requiring manual review`,
        description: 'A long description of the trigger and the events it receives, to inspect wrapping and card height.',
      },
      { id: 'description', title: 'With description', description: trigger.description ?? 'Starts this workflow with a test event.' },
    ]
    return {
      edges: [],
      viewport: { x: 36, y: 60, zoom: 0.75 },
      nodes: cases.map((entry, index) =>
        Object.assign({}, base, {
          id: entry.id,
          kind: 'trigger',
          title: entry.id === 'long' ? entry.title : `${entry.title} · ${trigger.name}`,
          description: entry.description,
          inputs: [],
          outputs: base.outputs,
          position: { x: (index % 3) * 420, y: Math.floor(index / 3) * 210 },
          diagnostics: entry.diagnostics,
          presentation: { kind: trigger.kind, schedules: entry.id === 'unconfigured' ? [] : schedules, source },
          run: entry.status
            ? {
                status: entry.status,
                error: entry.status === 'error' ? { message: 'Sample trigger failed' } : undefined,
                outputs: entry.status === 'success' ? { payload: fixture.payload } : undefined,
              }
            : undefined,
        }),
      ),
    }
  }, [fixture, trigger])
  return (
    <div className="workflow-story">
      <div className="overview-toolbar open-flow-workbench">
        <span>{trigger.name} · node states, configuration and long content</span>
      </div>
      <div className="workflow-canvas">
        <FlowCanvasView
          identity={`lab:trigger:${fixture.id}`}
          model={model}
          dark={dark}
          language={language}
          editable
          autoLayout={false}
          layoutMotion={false}
          addItems={[]}
          selectedNodeIds={selected}
          ignoredNodeIds={ignoredNodeIds}
          onIgnoreNodes={onIgnoreNodes}
          onSelectionChange={setSelected}
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

type RunState = 'empty' | 'ready' | 'invalid' | 'starting' | 'direct' | 'disabled'
function RunSample({ fixture, dark, language, log, state, downstream = false }: StoryProps & { state: RunState; downstream?: boolean }) {
  const [resource, setResource] = useState<{ store: RunRequestStore; inputs: ReturnType<typeof triggerDraft> }>()
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
      if (state !== 'direct' && state !== 'disabled') {
        await store.editDraft(flow, draft, 'trigger')
        if (disposed) return
        for (const group of store.$.inputRequest.value?.groups ?? []) {
          group.editor.replaceValues(
            state === 'empty'
              ? {}
              : group.nodeId === 'trigger'
                ? { payload: state === 'invalid' ? null : fixture.payload }
                : { message: state === 'invalid' ? 123 : 'Test message' },
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
      {resource && request && (
        <div className="run-input-popover trigger-run-panel">
          <RunInputPanel store={resource.store} theme={dark ? 'dark' : 'light'} onStarted={() => log('run.started')} />
        </div>
      )}
      <div className="trigger-run-dock">
        <RunControl
          disabled={state === 'disabled'}
          inputOpen={request != null}
          inputStatus={
            request ? (valid ? 'ready' : 'missing') : (resource?.store.inputStatus(resource.inputs.flow.flowId, resource.inputs.draft, 'trigger') ?? 'none')
          }
          onInputOpenChange={(open) => {
            // Gallery panels stay visible when another sample receives focus.
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
      <p className="trigger-gallery-note">
        {props.fixture.trigger.name} · Run input panels are open side by side.{' '}
        {direct
          ? 'This trigger runs directly; input panels below belong to a reachable node requiring a message.'
          : 'Payload fields use this trigger’s production schema.'}
      </p>
      <div className="trigger-case-grid">
        {direct && <RunSample {...props} state="direct" />}
        {(['empty', 'ready', 'invalid', 'starting'] as const).map((state) => (
          <RunSample key={state} {...props} state={state} downstream={direct} />
        ))}
        <RunSample {...props} state="disabled" />
      </div>
    </Gallery>
  )
}

type SidebarState = 'display' | 'edit' | 'unconfigured' | 'connection-error' | 'description'
function SidebarSample({ fixture, dark, language, log, state }: StoryProps & { state: SidebarState }) {
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
      <h3>{state.replaceAll('-', ' ')}</h3>
      <aside className="trigger-sidebar inspector" ref={sidebar}>
        <header className="trigger-sidebar-heading">
          <strong>{fixture.trigger.name}</strong>
        </header>
        {session && revision && (
          <NodeInspector
            variables={{ enabled: false, loaded: true, loading: false, names: [], onOpen: () => {} }}
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
      <p className="trigger-gallery-note">{props.fixture.trigger.name} · Production node inspector. Edits stay in this Lab session.</p>
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
                <NodeStory {...props} fixture={entry} />
              </section>
            ))}
          </div>
        ) : (
          <Gallery {...props}>
            <p className="trigger-gallery-note">
              {view === 'run'
                ? 'GitHub: object payload and validation · Gmail: event arrays · Google Drive: nested event data'
                : 'GitHub: long event choices and account states · Gmail: polling schedule and optional filters'}
            </p>
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
  ...triggerFixtures
    .filter(({ trigger }) => trigger.kind !== 'integration' && trigger.kind !== 'poll')
    .flatMap((fixture): FrontendStory[] => [
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-nodes`,
        title: 'Node states',
        standalone: true,
        render: (log, dark, language) => <NodeStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-run`,
        title: 'Run menu states',
        standalone: true,
        render: (log, dark, language) => <RunStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
      {
        group: `Trigger ${fixture.trigger.name}`,
        id: `trigger-${fixture.id}-sidebar`,
        title: 'Sidebar display & edit',
        standalone: true,
        render: (log, dark, language) => <SidebarStory fixture={fixture} log={log} dark={dark} language={language} />,
      },
    ]),
  ...(['nodes', 'run', 'sidebar'] as const).map(
    (view): FrontendStory => ({
      group: 'Trigger Provider',
      id: `trigger-provider-${view}`,
      title: view === 'nodes' ? 'Node states' : view === 'run' ? 'Run menu states' : 'Sidebar display & edit',
      standalone: true,
      render: (log, dark, language) => <ProviderStory view={view} log={log} dark={dark} language={language} />,
    }),
  ),
]
