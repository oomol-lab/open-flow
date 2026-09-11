import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { SetNotice } from '../../src/workbench/browser/runtime/stores/workbenchNotice.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useId, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { createCodeTask, createBuiltinTrigger, createValue } from '../../src/flow/common/nodeChanges.ts'
import { Button } from '../../src/ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../src/ui/browser/dialog.tsx'
import { notificationToasterProps, NotificationUndoLabel } from '../../src/ui/browser/public.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { CanvasHistoryControls } from '../../src/workbench/browser/runtime/editor/canvasHistoryControls.tsx'
import { CanvasHistoryScope } from '../../src/workbench/browser/runtime/editor/canvasHistoryScope.tsx'
import { WorkbenchCanvas } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { designerGraph, setComment, setNodePositions, setFlowViewport } from '../../src/workbench/browser/runtime/workspace.ts'
import { useStoryActions } from './storyActions.tsx'

const target = { kind: 'flow' } as const
const modes = ['Empty', 'Undo', 'Redo', 'Saving', 'Failed'] as const
function createSession(language: UiLanguage, log: LogAction, notify: SetNotice) {
  const i18n = createI18n(language)
  const timestamp = '2026-09-10T00:00:00.000Z'
  let sequence = 1
  let layoutRevision = 1
  let content: RevisionContent = applyFlowChanges(
    { modelVersion: 1, document: { graph: { nodes: {}, edges: [] }, tasks: {}, subflows: {}, bindings: {} }, modules: {} },
    [
      ...createBuiltinTrigger(target, 'trigger', { kind: 'cron', name: 'Schedule', cronTimes: [] }),
      ...createValue(target, 'value', 'Input'),
      ...createCodeTask(target, { nodeId: 'code', moduleId: 'module' }, 'Transform'),
      { kind: 'graph.edge.connect', target, edge: { source: 'value', target: 'code' } },
      { kind: 'graph.edge.connect', target, edge: { source: 'trigger', target: 'code' } },
    ],
  )
  let value: Readonly<Record<string, JsonValue>> = setComment(
    setNodePositions({}, target, { trigger: { x: 430, y: 200 }, value: { x: 0, y: 0 }, code: { x: 430, y: 0 } }),
    target,
    'note',
    {
      title: 'Review notes',
      content: 'Delete and undo to restore this note.\n\nThe code node and its connection can be restored together.',
      position: { x: 0, y: 200 },
    },
  )
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
        diagnostics:
          content.document.graph.nodes.code == null
            ? []
            : [
                {
                  code: 'module.syntax',
                  message: 'Simulated module syntax error',
                  path: '/modules/module/source',
                  line: 1,
                  column: 0,
                },
              ],
        engineContract: 'open-flow-engine/v2',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: content.document.graph.nodes.code == null,
        version: 1,
      })
    throw new Error(`Unexpected Lab request ${url.pathname}`)
  })
  const store = new WorkspaceStore(
    client,
    (notice) => {
      log('history.notice', notice)
      notify(notice)
    },
    undefined,
    i18n,
  )
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
  keyboardOnly = false,
  dark,
}: {
  language: UiLanguage
  log: LogAction
  mode: (typeof modes)[number]
  interactive?: boolean
  keyboardOnly?: boolean
  dark: boolean
}) {
  const toasterId = useId()
  const logRef = useRef(log)
  logRef.current = log
  const [session, setSession] = useState<ReturnType<typeof createSession>>()
  useEffect(() => {
    const toastIds = new Set<string | number>()
    const next = createSession(
      language,
      (name, value) => logRef.current(name, value),
      (notice) => {
        if (!interactive) return
        const options = {
          toasterId,
          action:
            notice.undo == null
              ? undefined
              : {
                  label: <NotificationUndoLabel>{notice.undo.label}</NotificationUndoLabel>,
                  onClick: () => {
                    toastIds.delete(toastId)
                    void notice.undo?.run()
                  },
                },
          duration: notice.kind == 'error' ? 8000 : 4000,
          onDismiss: ({ id }: { id: string | number }) => toastIds.delete(id),
          onAutoClose: ({ id }: { id: string | number }) => toastIds.delete(id),
        }
        const toastId: string | number = notice.kind == 'error' ? toast.error(notice.message, options) : toast.success(notice.message, options)
        toastIds.add(toastId)
      },
    )
    let disposed = false
    setSession(next)
    void next.store.selectFlow('history-lab').then(async () => {
      if (disposed) return
      next.store.selectNodes(['trigger', 'value', 'code', 'note'])
      if (mode == 'Saving') next.hold()
      if (mode == 'Failed') next.fail()
      if (mode != 'Empty') await next.store.moveNodes({ code: { x: 470, y: 0 } })
      if (!disposed && mode == 'Redo') await next.store.undo()
    })
    return () => {
      disposed = true
      next.dispose()
      for (const id of toastIds) toast.dismiss(id)
    }
  }, [language, mode, interactive, toasterId])
  return session == null ? null : (
    <>
      <HistorySession session={session} dark={dark} interactive={interactive} keyboardOnly={keyboardOnly} mode={mode} />
      {interactive && (
        <Toaster
          {...notificationToasterProps}
          id={toasterId}
          theme={dark ? 'dark' : 'light'}
          containerAriaLabel="Notifications"
          toastOptions={{ closeButtonAriaLabel: 'Close notification' }}
        />
      )}
    </>
  )
}

function HistorySession({
  session,
  dark,
  interactive,
  keyboardOnly,
  mode,
}: {
  session: ReturnType<typeof createSession>
  dark: boolean
  interactive: boolean
  keyboardOnly: boolean
  mode: string
}) {
  const { store, i18n } = session
  const history = useVal(store.history$)
  const draft = useVal(store.$.draft)
  const presentation = useVal(store.$.presentation)
  const diagnostics = useVal(store.$.diagnostics)
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
  const [actionVisible, setActionVisible] = useState(true)
  const model = designerGraph(draft, target, presentation?.value, diagnostics?.diagnostics, {}, {}, i18n.t)
  return (
    <I18nProvider i18n={i18n}>
      {keyboardOnly ? (
        <CanvasHistoryScope
          history={controls}
          disabled={draft == null || history.applying || history.failed}
          className="flex flex-col gap-4 rounded-lg border p-4"
        >
          <CanvasHistoryControls {...controls} />
          <Button variant="outline">Inspector action</Button>
          {actionVisible && (
            <Button
              variant="outline"
              onClick={() => {
                store.selectNodes(['code'])
                void store.duplicateSelectedNodes()
                setActionVisible(false)
              }}
            >
              Clone and remove focused action
            </Button>
          )}
          <input aria-label="Native text editor" placeholder="Native text undo" className="rounded border p-2" />
          <div role="textbox" contentEditable suppressContentEditableWarning aria-label="Rich text editor" className="rounded border p-2">
            Editable text
          </div>
          <Button
            variant="outline"
            onKeyDown={(event) => {
              if (event.key.toLowerCase() == 'z') event.preventDefault()
            }}
          >
            Consumes undo shortcut
          </Button>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogTitle>Dialog keyboard isolation</DialogTitle>
              <Button variant="outline">Dialog action</Button>
            </DialogContent>
          </Dialog>
          <output aria-label="Node count">Nodes: {model.nodes.length}</output>
        </CanvasHistoryScope>
      ) : interactive ? (
        <CanvasHistoryScope
          history={controls}
          disabled={draft == null || history.applying || history.failed}
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}
        >
          <HistoryCanvasActions session={session} />
          <div className="p-2">
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
        </CanvasHistoryScope>
      ) : (
        <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
          <strong>{mode}</strong>
          <CanvasHistoryControls {...controls} />
          {mode == 'Saving' && <HistorySaveAction session={session} />}
        </div>
      )}
    </I18nProvider>
  )
}

function HistoryCanvasActions({ session }: { session: ReturnType<typeof createSession> }) {
  const { store } = session
  const history = useVal(store.history$)
  useStoryActions([
    { label: 'Select mixed group', onClick: () => store.selectNodes(['trigger', 'value', 'code', 'note']) },
    { label: 'Edit title (clear history)', disabled: history.failed || history.applying, onClick: () => void store.saveNodeTitle('code', 'Edited transform') },
    { label: 'Hold saves', onClick: () => session.hold() },
    { label: 'Release saves', onClick: () => session.release() },
  ])
  return null
}

function HistorySaveAction({ session }: { session: ReturnType<typeof createSession> }) {
  useStoryActions([{ label: 'Finish save', onClick: () => session.release() }])
  return null
}

export const historyControlsStory: FrontendStory = {
  group: 'Undo & Redo',
  id: 'canvas-history-controls',
  title: 'Button states',
  description: 'Empty, undo, redo, saving, and failed states. Finish the held save or retry the failed sample.',
  standalone: true,
  render: (log, dark, language) => (
    <div className="open-flow-workbench open-flow-theme grid w-full grid-cols-5 gap-3 p-3" data-theme={dark ? 'dark' : 'light'}>
      {modes.map((mode) => (
        <HistorySample key={mode} mode={mode} language={language} log={log} dark={dark} />
      ))}
    </div>
  ),
}

export const historyStory: FrontendStory = {
  group: 'Undo & Redo',
  id: 'canvas-history',
  title: 'Canvas operations',
  description: 'Delete Input and undo/redo: the other edge and Transform’s simulated error stay visible. Hold saves to inspect pending changes.',
  standalone: true,
  render: (log, dark, language) => (
    <div
      className="open-flow-workbench open-flow-theme w-full"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      data-theme={dark ? 'dark' : 'light'}
    >
      <HistorySample mode="Empty" interactive language={language} log={log} dark={dark} />
    </div>
  ),
}

function HistoryKeyboardStory({ log, dark, language }: { log: LogAction; dark: boolean; language: UiLanguage }) {
  const [generation, setGeneration] = useState(0)
  useStoryActions([{ label: 'Reset samples', onClick: () => setGeneration((value) => value + 1) }])
  return (
    <div
      className="open-flow-workbench open-flow-theme gap-4 p-4"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', width: '100%' }}
      data-theme={dark ? 'dark' : 'light'}
      key={generation}
    >
      {['Editor A', 'Editor B'].map((label) => (
        <section key={label} aria-label={label} className="flex flex-col gap-3">
          <strong>{label}</strong>
          <HistorySample mode="Undo" keyboardOnly language={language} log={log} dark={dark} />
        </section>
      ))}
      <Button variant="outline">Host action outside editors</Button>
    </div>
  )
}

export const historyKeyboardStory: FrontendStory = {
  group: 'Undo & Redo',
  id: 'canvas-history-keyboard',
  title: 'Keyboard scope',
  standalone: true,
  description: 'Two independent editors exercise removed controls, inspector focus, text undo, dialogs, and host isolation.',
  render: (log, dark, language) => <HistoryKeyboardStory log={log} dark={dark} language={language} />,
}
