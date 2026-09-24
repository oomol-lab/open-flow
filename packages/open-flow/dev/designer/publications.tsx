import type { Flow, Live, Publication, PublishOperation, TriggerBinding } from '../../src/control/common/api.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { PublicationsView } from '../../src/workbench/browser/runtime/publications/publicationsView.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { useStoryActions } from './storyActions.tsx'

type Scenario = 'published' | 'empty' | 'failed' | 'pending' | 'stopped' | 'load-error'

function createSession(language: UiLanguage, scenario: Scenario, log: LogAction) {
  const timestamp = '2026-09-24T09:00:00.000Z'
  const flowId = 'publication-lab'
  let entries: Publication[] = Array.from({ length: 12 }, (_, index) => ({
    actorId: index % 2 == 0 ? 'user-alex-7a36e201' : 'user-sam-3f920d54',
    closureDigest: 'closure',
    createdAt: new Date(Date.parse(timestamp) - index * 14_400_000).toISOString(),
    engineContract: 'open-flow-engine/v5',
    flowId,
    modelVersion: currentFlowModelVersion,
    operation: index == 2 ? 'rollback' : 'publish',
    publicationId: `publication-${String(12 - index).padStart(8, '0')}`,
    revisionId: `revision-${String(index == 2 ? 5 : 12 - index).padStart(8, '0')}`,
    ...(index == 2 ? { sourcePublicationId: 'publication-00000005' } : {}),
    revisionDigest: 'revision',
    sharedAccessDigest: 'implicit:lab',
    version: 1,
  }))
  if (scenario == 'empty') entries = []
  let current = entries[0] ?? null
  let enabled = scenario != 'stopped'
  let failLoad = scenario == 'load-error'
  let sequence = 13
  let operation: PublishOperation | undefined =
    scenario == 'failed' || scenario == 'pending'
      ? {
          createdAt: timestamp,
          updatedAt: timestamp,
          flowId,
          operationId: 'operation-lab',
          revisionId: 'revision-draft',
          version: 1,
          ...(scenario == 'pending'
            ? { status: 'pending' }
            : { status: 'failed', issue: { code: 'publication.deadline-exceeded', message: 'The Publish operation exceeded its preparation deadline.' } }),
        }
      : undefined
  const flow = (): Flow => ({
    flowId,
    name: 'Customer onboarding',
    createdAt: timestamp,
    updatedAt: timestamp,
    draftRevisionId: 'revision-draft',
    status: 'active',
    version: 1,
    ...(current == null ? {} : { live: { enabled, publicationId: current.publicationId, revisionId: current.revisionId } }),
  })
  const live = (): Live => ({
    flowId,
    hasUnpublishedChanges: current?.revisionId != 'revision-draft',
    publication: current,
    revision: entries.length,
    status: current == null ? 'not-published' : enabled ? 'runnable' : 'suspended',
    version: 1,
  })
  let bindings: TriggerBinding[] =
    current == null
      ? []
      : [
          {
            flowId,
            triggerNodeId: 'new-customer',
            kind: 'webhook',
            health: 'healthy',
            operatorState: 'active',
            runtimeVersion: 1,
            updatedAt: timestamp,
            version: 1,
            endpointUrl: 'https://example.invalid/hooks/customer',
          },
          {
            flowId,
            triggerNodeId: 'check-accounts',
            kind: 'poll',
            health: 'needs_reauth',
            operatorState: 'active',
            runtimeVersion: 1,
            updatedAt: timestamp,
            version: 1,
            lastErrorCode: 'connection.expired',
          },
        ].map((binding) => Object.assign(binding, { currentPublicationId: current!.publicationId, currentRevisionId: current!.revisionId }) as TriggerBinding)
  const publish = (revisionId: string, source?: Publication): Publication => {
    const next: Publication = {
      actorId: 'user-alex-7a36e201',
      closureDigest: 'closure',
      engineContract: 'open-flow-engine/v5',
      flowId,
      modelVersion: currentFlowModelVersion,
      revisionDigest: 'revision',
      sharedAccessDigest: 'implicit:lab',
      version: 1,
      createdAt: new Date(Date.parse(timestamp) + sequence * 60_000).toISOString(),
      publicationId: `publication-${String(sequence++).padStart(8, '0')}`,
      revisionId,
      operation: source == null ? 'publish' : 'rollback',
      ...(source == null ? {} : { sourcePublicationId: source.publicationId }),
    }
    entries = [next, ...entries]
    current = next
    bindings = bindings.map((binding) => ({ ...binding, currentPublicationId: next.publicationId, currentRevisionId: next.revisionId }))
    return next
  }
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : String(path), 'https://lab.invalid')
    const route = url.pathname
    if (route == '/v1/flows') return Response.json({ flows: [flow()], total: 1, version: 1 })
    if (route.endsWith('/editor'))
      return Response.json({
        flow: flow(),
        draft: {
          actorId: 'lab',
          createdAt: timestamp,
          digest: 'draft',
          flowId,
          modelVersion: currentFlowModelVersion,
          parentRevisionId: null,
          revisionId: 'revision-draft',
          version: 1,
          content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] }, subflows: {}, tasks: {} } },
        },
        live: live(),
        presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
        version: 1,
      })
    if (route.endsWith('/check'))
      return Response.json({
        closureDigest: 'closure',
        diagnostics: [],
        engineContract: 'open-flow-engine/v5',
        flowId,
        modelVersion: currentFlowModelVersion,
        revisionDigest: 'draft',
        revisionId: 'revision-draft',
        valid: true,
        version: 1,
      })
    if (route.endsWith('/live')) {
      if (failLoad) {
        failLoad = false
        return Response.json({ code: 'unavailable', message: 'Sample load failure', version: 1 }, { status: 503 })
      }
      return Response.json(live())
    }
    if (route.endsWith('/publications') && init?.method != 'POST') {
      // Small pages exercise selection across pagination and refreshes.
      const offset = Number(url.searchParams.get('cursor') ?? 0)
      const end = offset + 6
      return Response.json({
        publications: entries.slice(offset, end),
        total: entries.length,
        ...(end < entries.length ? { nextCursor: String(end) } : {}),
        version: 1,
      })
    }
    if (route.endsWith('/triggers')) return Response.json({ flowId, bindings, version: 1 })
    if (route.includes('/publish-operations/')) return Response.json(operation)
    if (route.endsWith('/publications') && init?.method == 'POST') {
      log('publication.publish')
      const next = publish('revision-draft')
      operation = {
        flowId,
        operationId: 'operation-lab',
        createdAt: timestamp,
        updatedAt: timestamp,
        revisionId: next.revisionId,
        publicationId: next.publicationId,
        status: 'succeeded',
        version: 1,
      }
      return Response.json(operation)
    }
    if (route.endsWith('/rollback')) {
      const source = entries.find((item) => item.publicationId == route.split('/').at(-2))!
      log('publication.rollback', source.publicationId)
      return Response.json(publish(source.revisionId, source))
    }
    if (route.endsWith('/enabled')) {
      enabled = JSON.parse(String(init?.body)).enabled
      log('publication.enabled', enabled)
      return Response.json(flow())
    }
    if (route.includes('/triggers/')) {
      const id = route.split('/triggers/')[1]!.split('/')[0]!
      if (route.endsWith('/activities')) return Response.json({ flowId, triggerNodeId: id, activities: [], version: 1 })
      if (route.endsWith('/pause') || route.endsWith('/resume')) {
        bindings = bindings.map((binding) =>
          binding.triggerNodeId == id ? { ...binding, operatorState: route.endsWith('/pause') ? 'paused' : 'active' } : binding,
        )
        log('trigger.toggle', id)
      }
      if (route.endsWith('/test')) {
        log('trigger.test', id)
        return Response.json({ flowId, triggerNodeId: id, events: [], filtered: 0, hasMore: false, version: 1 })
      }
      return Response.json({ binding: bindings.find((binding) => binding.triggerNodeId == id), version: 1 })
    }
    if (route.endsWith('/connector-access'))
      return Response.json({ accessRevision: 0, mode: 'implicit', sharedAccessDigest: 'implicit:lab', bindings: [], version: 1 })
    throw new Error(`Unexpected Publications Lab request: ${route}`)
  })
  const preferences = new Map<string, string>(operation == null ? [] : [[`publish-operation:${flowId}`, operation.operationId]])
  const i18n = createI18n(language)
  const store = new WorkbenchStore(
    client,
    {
      getItem: (key) => preferences.get(key) ?? null,
      setItem: (key, value) => {
        preferences.set(key, value)
      },
    },
    undefined,
    i18n,
  )
  const stopNotice = store.$.notice.reaction((notice) => {
    if (notice != null) log('publication.notice', notice)
  })
  return {
    store,
    i18n,
    async start() {
      await store.workspace.start(flowId)
      await store.publications.load(flowId)
    },
    dispose() {
      stopNotice()
      store.dispose()
      i18n.dispose()
    },
  }
}

function PublicationsStory({ language, dark, log }: { readonly language: UiLanguage; readonly dark: boolean; readonly log: LogAction }) {
  const [scenario, setScenario] = useState<Scenario>('published')
  const [session, setSession] = useState<ReturnType<typeof createSession>>()
  const [open, setOpen] = useState(true)
  const logRef = useRef(log)
  logRef.current = log
  useStoryActions([
    ...(['published', 'empty', 'failed', 'pending', 'stopped', 'load-error'] as const).map((value) => ({
      label: value,
      disabled: value == scenario,
      onClick: () => {
        setScenario(value)
        setOpen(true)
      },
    })),
    { label: 'Refresh publications', disabled: session == null, onClick: () => void session?.store.publications.load('publication-lab') },
    { label: 'Reopen', disabled: open, onClick: () => setOpen(true) },
  ])
  useEffect(() => {
    const next = createSession(language, scenario, (name, value) => logRef.current(name, value))
    setSession(next)
    void next.start()
    return () => next.dispose()
  }, [language, scenario])
  return (
    <div className="open-flow-workbench open-flow-theme grid h-full min-h-0" data-theme={dark ? 'dark' : 'light'}>
      {session != null && open && (
        <I18nProvider i18n={session.i18n}>
          <PublicationsView
            key={`${scenario}-${language}`}
            store={session.store}
            onClose={() => {
              setOpen(false)
              log('publications.close')
            }}
          />
        </I18nProvider>
      )}
    </div>
  )
}

export const publicationsStory: FrontendStory = {
  group: 'Workbench',
  id: 'publications',
  title: 'Publications',
  standalone: true,
  description:
    'Browse publication history, confirm a rollback, and inspect current triggers. Compare unpublished, pending, failed, stopped and retry states in both themes and narrow layouts.',
  render: (log, dark, language) => <PublicationsStory language={language} dark={dark} log={log} />,
}
