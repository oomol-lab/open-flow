import type { Flow } from '../../src/control/common/api.ts'
import type { WorkflowFile } from '../../src/flow/common/workflowFile.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { OpenFlowWorkbenchHandle } from '../../src/workbench/browser/runtime/contract.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { I18nProvider } from 'val-i18n-react'
import { notificationToasterProps } from '../../src/ui/browser/public.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { FlowBrowser } from '../../src/workbench/browser/runtime/shell/resourceBrowser.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { useStoryActions } from './storyActions.tsx'

const sampleWorkflow: WorkflowFile = {
  kind: 'open-flow-workflow',
  version: 1,
  name: 'Sample workflow',
  content: {
    modelVersion: 6,
    modules: {},
    document: { bindings: {}, graph: { nodes: { start: { inputDefs: [], kind: 'start', name: 'Start' } }, edges: [] } },
  },
  presentation: {},
}
const sampleText = JSON.stringify({ ...sampleWorkflow, name: 'GitHub sample' })

function FlowBrowserStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const importRef = useRef<OpenFlowWorkbenchHandle>(null)
  const [referenceFailure, setReferenceFailureState] = useState<'none' | 'initial' | 'next'>('none')
  const referenceFailureRef = useRef<typeof referenceFailure>('none')
  function setReferenceFailure(next: typeof referenceFailure): void {
    referenceFailureRef.current = next
    setReferenceFailureState(next)
  }
  const [teamState, setTeamState] = useState<'ready' | 'loading' | 'disabled'>('ready')
  const tagFailureRef = useRef<'none' | 'read' | 'save'>('none')
  const [failImport, setFailImport] = useState(false)
  const [single, setSingle] = useState(false)
  const [embedded, setEmbedded] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState<{ connect: () => void; i18n: ReturnType<typeof createI18n>; store: WorkbenchStore }>()
  useStoryActions([
    {
      label: 'Fail next tag read',
      onClick: () => {
        tagFailureRef.current = 'read'
        void session?.store.tags.reload()
      },
    },
    {
      label: 'Fail next tag save',
      onClick: () => {
        tagFailureRef.current = 'save'
      },
    },
    { label: referenceFailure == 'initial' ? 'Initial failure armed' : 'Fail initial reference request', onClick: () => setReferenceFailure('initial') },
    { label: referenceFailure == 'next' ? 'Next-page failure armed' : 'Fail next reference page', onClick: () => setReferenceFailure('next') },
    {
      label: 'Import external file',
      onClick: () =>
        log(
          'import.open',
          importRef.current?.openImport({ text: sampleText, fileName: 'demo.openflow.json', sourceUrl: 'https://github.com/oomol-lab/open-flow' }),
        ),
    },
    { label: 'Import invalid file', onClick: () => log('import.open', importRef.current?.openImport({ text: '{}' })) },
    { label: failImport ? 'Allow import submission' : 'Fail import submission', onClick: () => setFailImport(!failImport) },
    { label: 'Team: ' + teamState, onClick: () => setTeamState(teamState == 'ready' ? 'loading' : teamState == 'loading' ? 'disabled' : 'ready') },
    {
      label: single ? 'Show status examples' : 'Show single workflow',
      onClick: () => {
        setSingle(!single)
        setEmbedded(true)
      },
    },
    { label: embedded ? 'Standalone layout' : 'Embedded layout', onClick: () => setEmbedded(!embedded) },
    { label: empty ? 'Show workflows' : 'Show empty list', onClick: () => setEmpty(!empty) },
    { label: initializing ? 'Finish startup' : 'Show startup', onClick: () => setInitializing(!initializing) },
    {
      label: 'Connect notifications',
      disabled: session == null || connected,
      onClick: () => {
        session?.connect()
        setConnected(true)
      },
    },
  ])
  useEffect(() => {
    setConnected(false)
    const connection = Promise.withResolvers<void>()
    const i18n = createI18n(language)
    const flows: Flow[] = (
      single ? ['xxx'] : ['Published flow', 'Unpublished changes with a long flow name', 'Disabled flow', 'Draft flow', 'Untagged flow']
    ).map((name, index) => {
      const flow: Flow = {
        flowId: single ? 'flow_7a7ca0123456789abcdef67e0dd' : `flow-list-sample-${index}`,
        name,
        tagIds: index == 0 ? ['production', 'sales'] : index == 1 ? ['ai', 'operations', 'notifications', 'knowledge', 'sales'] : index < 4 ? ['ai'] : [],
        createdAt: '2026-09-24T09:00:00.000Z',
        updatedAt: '2026-09-24T09:00:00.000Z',
        draftRevisionId: 'draft',
        resourceReferences: {
          draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
          sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
        },
        status: 'active',
        version: 1,
      }
      return index >= 3
        ? flow
        : Object.assign(flow, {
            live: { hasStart: true, enabled: index != 2, publicationId: `publication-${index}`, revisionId: index == 1 ? 'previous' : 'draft' },
          })
    })
    const referencedFlowId = flows[0]?.flowId
    let tags = [
      'Production',
      'Sales operations with a long tag name',
      'AI integrations with a long tag name',
      'Operations',
      'Notifications',
      'Knowledge base with a long tag name',
    ].map((name, index) => ({
      tagId: ['production', 'sales', 'ai', 'operations', 'notifications', 'knowledge'][index]!,
      name,
      version: 1,
    }))
    let reads = 0
    const client = new WorkbenchClient(
      async (path, init) => {
        const url = String(path).split('?')[0]!
        const mutation = init?.method != null && init.method != 'GET'
        if (
          (url == '/v1/tags' && tagFailureRef.current == 'read') ||
          (mutation && (url.startsWith('/v1/tags') || url.endsWith('/tags')) && tagFailureRef.current == 'save')
        ) {
          tagFailureRef.current = 'none'
          return Response.json({ message: 'Tag request failed' }, { status: 500 })
        }
        if (url == '/v1/tags' && !mutation)
          return Response.json({
            tags: tags.map((tag) => ({ ...tag, referenceCount: flows.filter((flow) => flow.tagIds?.includes(tag.tagId)).length })),
            version: 1,
          })
        if (url.startsWith('/v1/tags') && mutation) {
          const id = url.split('/')[3]
          const previous = tags.find((tag) => tag.tagId == id)
          if (init?.method == 'DELETE') {
            tags = tags.filter((tag) => tag.tagId != id)
            for (let position = 0; position < flows.length; position++)
              flows[position] = { ...flows[position]!, tagIds: flows[position]!.tagIds?.filter((tagId) => tagId != id) ?? [] }
            return Response.json({ version: 1 })
          }
          const { name } = JSON.parse(String(init?.body)) as { name: string }
          if (tags.some((tag) => tag.name.toLowerCase() == name.trim().toLowerCase() && tag.tagId != id))
            return Response.json({ error: { code: 'tag.conflict', message: 'A tag with this name already exists.' } }, { status: 409 })
          const tag = { tagId: id ?? `tag-${tags.length}`, name: name.trim(), version: 1 }
          tags = previous == null ? [...tags, tag] : tags.map((item) => (item.tagId == id ? tag : item))
          return Response.json(tag)
        }
        const index = flows.findIndex(
          (flow) => url == `/v1/flows/${flow.flowId}` || url == `/v1/flows/${flow.flowId}/enabled` || url == `/v1/flows/${flow.flowId}/tags`,
        )
        const flow = flows[index]
        if (flow != null && init?.method == 'PUT' && url.endsWith('/tags')) {
          const { tagIds } = JSON.parse(String(init.body)) as { tagIds: string[] }
          flows[index] = { ...flow, tagIds }
          log('flow.tags', tagIds)
          return Response.json(flows[index])
        }
        if (flow != null && init?.method == 'DELETE') {
          flows.splice(index, 1)
          log('flow.delete', flow.flowId)
          return Response.json({ ...flow, status: 'retiring' }, { status: 202 })
        }
        if (flow != null && init?.method == 'PATCH') {
          const { name, tagIds } = JSON.parse(String(init.body)) as { name?: string; tagIds?: string[] }
          flows[index] = { ...flow, ...(name == null ? {} : { name }), ...(tagIds == null ? {} : { tagIds }) }
          log('flow.settings', { name, tagIds })
          return Response.json(flows[index])
        }
        if (flow?.live != null && init?.method == 'PUT' && url.endsWith('/enabled')) {
          const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean }
          flows[index] = { ...flow, live: { ...flow.live, enabled } }
          log('flow.enabled', enabled)
          return Response.json(flows[index])
        }
        if (url.endsWith('/references')) {
          await Promise.resolve()
          init?.signal?.throwIfAborted()
          const offset = Number(new URL(String(path), 'https://lab.local').searchParams.get('offset') ?? 0)
          if (referenceFailureRef.current == 'initial' || (referenceFailureRef.current == 'next' && offset > 0)) {
            setReferenceFailure('none')
            return Response.json({ message: 'Reference request failed' }, { status: 500 })
          }
          const references = Array.from({ length: url == `/v1/flows/${referencedFlowId}/references` ? 53 : 0 }, (_, position) => ({
            flowId: `referencing-flow-${position}`,
            name: position == 0 ? 'Workflow with a long name that wraps within the references popover' : `Referencing workflow ${position + 1}`,
            available: true,
            draft: position % 3 != 1,
            live: position % 3 == 0 ? null : { publicationId: `publication-${position}`, enabled: position % 3 != 2 },
          }))
          return Response.json({
            version: 1,
            direction: 'incoming',
            total: references.length,
            references: references.slice(offset, offset + 50),
            ...(offset + 50 < references.length ? { nextOffset: offset + 50 } : {}),
          })
        }
        if (url.endsWith('/export')) return Response.json(sampleWorkflow)
        if (url.endsWith('/error-listeners'))
          return Response.json({
            version: 1,
            listeners:
              url == `/v1/flows/${referencedFlowId}/error-listeners`
                ? [{ flowId: 'error-handler', flowName: 'Error notifications', nodeId: 'error', nodeName: 'Workflow failure', enabled: false }]
                : [],
          })
        if (String(path).split('?')[0] == '/v1/flows') {
          const catalog =
            reads++ == 0
              ? flows
              : flows.map((item, position) => (position == 3 && item.name == 'Draft flow' ? Object.assign({}, item, { name: 'Updated draft flow' }) : item))
          const parameters = new URL(String(path), 'https://lab.local').searchParams
          const query = parameters.get('query') ?? ''
          const ids = parameters.get('tagIds')?.split(',') ?? []
          const untagged = parameters.get('untagged') == 'true'
          const matches = catalog.filter(
            (item) =>
              item.name.toLowerCase().includes(query) &&
              ((ids.length == 0 && !untagged) || item.tagIds?.some((tagId) => ids.includes(tagId)) || (untagged && (item.tagIds?.length ?? 0) == 0)),
          )
          return Response.json({
            version: 1,
            flows: empty ? [] : matches.map((item) => ({ ...item, referenceCount: item.flowId == referencedFlowId ? 53 : 0 })),
            total: empty ? 0 : matches.length,
          })
        }
        if (flow != null && !mutation) return Response.json(flow)
        return Response.json({ message: 'Unsupported story action' }, { status: 400 })
      },
      undefined,
      () => ({ ready: connection.promise, stop: () => connection.resolve() }),
    )
    const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    const stopNotice = store.$.notice.reaction((notice) => {
      if (notice?.kind === 'error') toast.error(notice.message)
      else if (notice != null) toast.success(notice.message)
    })
    setSession({ connect: () => connection.resolve(), i18n, store })
    void store.start()
    return () => {
      stopNotice()
      toast.dismiss()
      store.dispose()
      i18n.dispose()
    }
  }, [empty, language, log, single])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-[520px] w-full" data-theme={dark ? 'dark' : 'light'}>
        <Toaster {...notificationToasterProps} theme={dark ? 'dark' : 'light'} />
        <FlowBrowser
          ref={importRef}
          catalogWidth={embedded ? 'embedded' : undefined}
          createFlowDisabled={teamState != 'ready'}
          createFlowField={
            teamState == 'loading'
              ? {
                  state: 'loading',
                  label: 'Team',
                  description: 'The host is loading available teams.',
                  status: 'Loading teams…',
                }
              : {
                  state: 'ready',
                  ariaLabel: 'Team',
                  label: 'Team',
                  description: 'The workflow uses this team after creation.',
                  options: [{ label: 'Sample team', value: 'sample-team' }],
                  value: 'sample-team',
                  onValueChange: () => {},
                }
          }
          initializing={initializing}
          language={language}
          store={session.store}
          hrefForFlow={(flow, view = 'design') => `#${flow.flowId}/${view}`}
          onCreateFlow={async (name, tagIds) => {
            log('flow.create', { name, tagIds })
            return true
          }}
          onImportFlow={async (file, name, key, tagIds) => {
            log('flow.import', { file, name, key, tagIds })
            if (failImport) session.store.workspace.notify({ kind: 'error', message: session.i18n.t('notice.requestFailed') })
            return !failImport
          }}
          onSelectFlow={(flow, view = 'design') => log('flow.open', { flowId: flow.flowId, view })}
        />
      </div>
    </I18nProvider>
  )
}

export const flowBrowserStory: FrontendStory = {
  group: 'Workbench',
  id: 'flow-browser',
  title: 'Flow list',
  description:
    'Tags appear below names on one line. Long labels truncate and the overflow count stays on that line; its menu exposes the remaining tags without changing row height. Click a tag or use the tag filter to combine labels, untagged flows and name search. Selected conditions sit below a divider with a leading filter icon; check their wrapping and clear/remove actions at compact widths. Open Flow settings from a row menu to edit the title and tags together. Unsaved title or tag changes require confirmation when cancelling, closing, pressing Escape, clicking the backdrop or following a tag usage link. Continue editing retains both fields; discard closes without saving. Restoring the original values allows closing immediately. The list uses an icon to open tag filters. Settings, create and import forms place an Add tags chip beside selected tags. Search stays inside the shared panel; verify keyboard search, multiple selections, creating a tag, management and focus restoration. The filter hint remains visible. Tag, untagged and create options use distinct icons; the row, icon, label and usage count share a pointer cursor. Manage tags uses the Flow list toolbar and table, with a count, search, New tag button and row action menus. The close button shares the header controls’ center line; at narrow widths, search and New tag move below the title and close button. Check name truncation, reference links, anchored create/rename forms that keep the table stationary, and focus after saving or cancelling deletion. Duplicate tag names use input-attached danger feedback. Fail next tag read and Fail next tag save each fail once to exercise retry. Check centered usage counts across used and unused tags. Open the AI tag usage to compare draft, changed, disabled and long-name flows: the workflow icon and name sit on the left with compact publication/runtime chips on the right, following Variables reference rows. Workflow names stay on one line with ellipses and full-text tooltips. Panel titles may wrap across lines. Status chips wrap at narrow widths, and drafts show only one state. Flow reference counts also load a second page. Fail initial reference request and Fail next reference page each fail once, allowing retry without losing loaded rows. Reference links log their target flow and view. Delete the first row to inspect compact impact summaries; expand each summary for calling workflows or error listeners. The other rows have no references. Reference lookup failures block deletion until retry succeeds. Deleting removes only the sample workflow. Show single workflow reproduces a short name and a full-length ID in an embedded list. Compare column spacing at wide and compact widths; search and dialog inputs keep the same text size at both widths. Hover or focus a flow name to see its full text. Hover, focus, or click a Flow ID to inspect its full value and copy action; Escape closes the tooltip. Embedded layout leaves page width and spacing to the host. Show empty list to inspect the empty state. New Flow and Import workflow include a team field for checking modal controls. Import external file and Import invalid file exercise the production ref entry. The source link sits beneath the dialog title and uses the muted theme color. Fail import submission keeps the dialog open for retry; submitted keys are logged. Team cycles ready, loading and disabled submission states. Import accepts .openflow.json files and logs the submitted content; malformed files show a notification without moving the table. Row menus export a deterministic sample file that can be imported again. The list loads before notifications connect. Connect notifications to refresh the Draft row without clearing the list. Show startup to inspect the skeleton. Use the row menu to rename a flow, start/stop its publication, or open publication and run history (logged with the target flow and view). With a name filter active, rename a matching flow so it no longer matches: it leaves the list immediately. Starting/stopping also refreshes the filtered row without connecting notifications. Check that renaming stays centered on the flow name with compact controls; invalid names show feedback below the controls, and Enter, Escape, and Cancel retain their usual behavior. Search for Published flow to verify the menu extends beyond a single-row table. The name column receives more flexible space; the action column fits its reference count and menu. Compare publication and runtime columns with equal flexible space at each width. At compact widths, flow names and status columns stay aligned across rows. Switch language and theme to inspect labels and menus.',
  standalone: true,
  render: (log, dark, language) => <FlowBrowserStory dark={dark} language={language} log={log} />,
}
