import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { createCodeTask, createValue } from '../../src/flow/common/nodeChanges.ts'
import { Button } from '../../src/ui/browser/button.tsx'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { CanvasHistoryControls } from '../../src/workbench/browser/runtime/editor/canvasHistoryControls.tsx'
import { WorkbenchCanvas } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { designerGraph, setComment, setNodePositions, setFlowViewport } from '../../src/workbench/browser/runtime/workspace.ts'

const target = { kind: 'flow' } as const
const modes = ['Empty', 'Undo', 'Redo', 'Saving', 'Failed'] as const
function createSession(language: UiLanguage, log: LogAction) {
  const i18n = createI18n(language)
  const timestamp = '2026-09-10T00:00:00.000Z'
  let sequence = 1
  let layoutRevision = 1
  let content: RevisionContent = applyFlowChanges(
    { modelVersion: 1, document: { graph: { nodes: {}, edges: [] }, tasks: {}, subflows: {}, bindings: {} }, modules: {} },
    [
      ...createValue(target, 'value', 'Input'),
      ...createCodeTask(target, { nodeId: 'code', moduleId: 'module' }, 'Transform'),
      { kind: 'graph.edge.connect', target, edge: { source: 'value', target: 'code' } },
    ],
  )
  let value: Readonly<Record<string, JsonValue>> = setComment(setNodePositions({}, target, { value: { x: 0, y: 0 }, code: { x: 430, y: 0 } }), target, 'note', {
    title: 'Review notes',
    content: 'Delete and undo to restore this note.\n\nThe code node and its connection can be restored together.',
    position: { x: 0, y: 200 },
  })
  value = setFlowViewport(value, target, { x: 36, y: 72, zoom: 0.7 })
  const flow = {
    flowId: 'history-lab',
    name: 'Canvas history',
    draftRevisionId: 'r1',
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    status: 'active',
  }
  const revision = () => ({
    actorId: 'lab',
    createdAt: timestamp,
    digest: `digest-${sequence}`,
    flowId: flow.flowId,
    modelVersion: 1,
    parentRevisionId: sequence == 1 ? null : `r${sequence - 1}`,
    revisionId: `r${sequence}`,
    version: 1,
  })
  let hold: Promise<void> | undefined
  let fail = false
  let offline = false
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : path, 'https://lab.invalid')
    if (url.pathname.endsWith('/editor')) {
      if (offline) throw new Error('Lab offline')
      return Response.json({
        flow,
        draft: { ...revision(), content },
        presentation: { revision: layoutRevision, updatedAt: timestamp, value, version: 1 },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        version: 1,
      })
    }
    if (url.pathname.endsWith('/draft/changes')) {
      await hold
      const body = JSON.parse(String(init?.body)) as { operations: ChangeOperation[] }
      content = applyFlowChanges(content, body.operations)
      sequence++
      return Response.json({ revision: revision(), version: 1 })
    }
    if (url.pathname.endsWith('/presentation')) {
      await hold
      if (fail) {
        fail = false
        return Response.json({ error: { code: 'request.failed', message: 'Lab save failure' }, version: 1 }, { status: 500 })
      }
      if (init?.method == 'PUT') {
        value = JSON.parse(String(init.body)).value
        layoutRevision++
      }
      return Response.json({ revision: layoutRevision, updatedAt: timestamp, value, version: 1 })
    }
    if (url.pathname.endsWith('/check'))
      return Response.json({
        closureDigest: 'lab',
        diagnostics: [],
        engineContract: 'open-flow-engine/v2',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: true,
        version: 1,
      })
    throw new Error(`Unexpected Lab request ${url.pathname}`)
  })
  const store = new WorkspaceStore(client, (notice) => log('history.notice', notice), undefined, i18n)
  let release: (() => void) | undefined
  return {
    store,
    i18n,
    hold() {
      hold = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    release() {
      hold = undefined
      release?.()
    },
    fail() {
      fail = true
      offline = true
    },
    online() {
      offline = false
    },
    dispose() {
      release?.()
      store.dispose()
      i18n.dispose()
    },
  }
}

function HistorySample({
  language,
  log,
  mode,
  interactive = false,
  dark,
}: {
  language: UiLanguage
  log: LogAction
  mode: (typeof modes)[number]
  interactive?: boolean
  dark: boolean
}) {
  const logRef = useRef(log)
  logRef.current = log
  const [session, setSession] = useState<ReturnType<typeof createSession>>()
  useEffect(() => {
    const next = createSession(language, (name, value) => logRef.current(name, value))
    let disposed = false
    setSession(next)
    void next.store.selectFlow('history-lab').then(async () => {
      if (disposed) return
      next.store.selectNodes(['code', 'note'])
      if (mode == 'Saving') next.hold()
      if (mode == 'Failed') next.fail()
      if (mode != 'Empty') await next.store.moveNodes({ code: { x: 470, y: 0 } })
      if (!disposed && mode == 'Redo') await next.store.undo()
    })
    return () => {
      disposed = true
      next.dispose()
    }
  }, [language, mode])
  return session == null ? null : <HistorySession session={session} dark={dark} interactive={interactive} mode={mode} />
}

function HistorySession({
  session,
  dark,
  interactive,
  mode,
}: {
  session: ReturnType<typeof createSession>
  dark: boolean
  interactive: boolean
  mode: string
}) {
  const { store, i18n } = session
  const history = useVal(store.history$)
  const draft = useVal(store.$.draft)
  const presentation = useVal(store.$.presentation)
  const selected = useVal(store.$.selectedNodeIds)
  const options = useVal(store.$.addNodeOptions)
  const [ignored, setIgnored] = useState<readonly string[]>([])
  const controls = {
    state: history,
    onUndo: () => void store.undo(),
    onRedo: () => void store.redo(),
    onRetry: () => {
      session.online()
      void store.retryHistorySync()
    },
  }
  const model = designerGraph(draft, target, presentation?.value, [], {}, {}, i18n.t)
  return (
    <I18nProvider i18n={i18n}>
      {interactive ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
          <div className="flex gap-2 p-2">
            <Button variant="outline" onClick={() => store.selectNodes(['code', 'note'])}>
              Select code + comment
            </Button>
            <Button variant="outline" disabled={history.failed || history.applying} onClick={() => void store.saveNodeTitle('code', 'Edited transform')}>
              Edit title (clear history)
            </Button>
            <Button variant="outline" onClick={() => session.hold()}>
              Hold saves
            </Button>
            <Button variant="outline" onClick={() => session.release()}>
              Release saves
            </Button>
            <input aria-label="Text undo isolation" placeholder="Text undo stays here" className="border rounded px-2" />
          </div>
          <div className="editor-grid context-panel-closed" style={{ flex: 1, minHeight: 0 }}>
            <WorkbenchCanvas
              history={controls}
              model={model}
              theme={dark ? 'dark' : 'light'}
              target={target}
              selectedNodeIds={selected}
              addNodeOptions={options}
              disabled={draft == null || history.applying || history.failed}
              blocksOpen={false}
              inspectorOpen={false}
              ignoredNodeIds={ignored}
              onIgnoreNodes={(ids, ignore) => setIgnored(ignore ? [...ignored, ...ids] : ignored.filter((id) => !ids.includes(id)))}
              onAddNode={(...args) => store.addNode(...args)}
              onConnect={(edge) => void store.connect(edge)}
              onDeleteEdge={(edge) => void store.disconnect(edge)}
              onDeleteNodes={() => void store.deleteSelectedNodes()}
              onChangeComment={(id, comment) => void store.saveComment(id, comment)}
              onCopy={() => store.copySelectedNodes()}
              onDuplicate={(...args) => void store.duplicateSelectedNodes(...args)}
              onPaste={() => void store.pasteNodes()}
              onMoveNodes={(positions) => void store.moveNodes(positions)}
              onMoveViewport={(viewport) => void store.moveViewport(viewport)}
              onSelectNodes={(ids) => store.selectNodes(ids)}
              onOpenBlocks={() => {}}
              onOpenInspector={() => {}}
              onToggleInspector={() => {}}
              provideAddNodeOptions={async () => options}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
          <strong>{mode}</strong>
          <CanvasHistoryControls {...controls} />
          {mode == 'Saving' && (
            <Button variant="ghost" onClick={() => session.release()}>
              Finish save
            </Button>
          )}
        </div>
      )}
    </I18nProvider>
  )
}

export const historyStory: FrontendStory = {
  group: 'Canvas',
  id: 'canvas-history',
  title: 'Undo & Redo',
  standalone: true,
  render: (log, dark, language) => (
    <div
      className="open-flow-workbench open-flow-theme w-full"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      data-theme={dark ? 'dark' : 'light'}
    >
      <div className="grid grid-cols-5 gap-3 p-3">
        {modes.map((mode) => (
          <HistorySample key={mode} mode={mode} language={language} log={log} dark={dark} />
        ))}
      </div>
      <HistorySample mode="Empty" interactive language={language} log={log} dark={dark} />
    </div>
  ),
}
