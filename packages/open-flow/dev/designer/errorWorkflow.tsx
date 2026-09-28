import type { Flow, RunDetails } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory } from './stories.tsx'

import { useEffect, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { ErrorTriggerSources } from '../../src/workbench/browser/runtime/editor/errorTriggerSources.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ErrorHandling, RunLinkContext } from '../../src/workbench/browser/runtime/runs/errorHandling.tsx'
import { useStoryActions } from './storyActions.tsx'

const flows: readonly Flow[] = ['source', 'handler', 'upstream-2', 'offline'].map((flowId) => ({
  flowId,
  name: flowId == 'handler' ? 'Orders · Production payment events and fulfillment updates' : flowId,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  draftRevisionId: 'draft',
  status: 'active',
  version: 1,
  live: flowId == 'offline' ? undefined : { enabled: true, publicationId: 'publication', revisionId: 'revision' },
}))
const run: RunDetails = {
  runId: 'source-run',
  flowId: 'source',
  createdAt: '2026-01-01T00:00:00Z',
  finishedAt: '2026-01-01T00:00:01Z',
  status: 'failed',
  source: 'live',
  version: 1,
  revisionId: 'revision',
  publicationId: 'publication',
  closureDigest: 'closure',
  engineContract: 'engine',
  engineDigest: 'engine',
  modelVersion: 5,
  sharedAccessDigest: 'access',
  revisionDigest: 'revision',
  waits: [],
}

function Sample({ dark, language }: { dark: boolean; language: Parameters<FrontendStory['render']>[2] }) {
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  const [value, setValue] = useState<readonly string[]>([])
  const [unavailable, setUnavailable] = useState<readonly string[]>(['offline'])
  const [readOnly, setReadOnly] = useState(false)
  useStoryActions([
    { label: readOnly ? 'Enable editing' : 'Read only', onClick: () => setReadOnly(!readOnly) },
    { label: 'Reset', onClick: () => setValue([]) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme grid gap-6 p-6" data-theme={dark ? 'dark' : 'light'}>
        <div className="grid gap-6 md:grid-cols-2">
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Choose published upstream workflows</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={value} disabled={readOnly} onChange={setValue} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Selected workflow unavailable</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={unavailable} disabled={readOnly} onChange={setUnavailable} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>No eligible workflow</h3>
            <ErrorTriggerSources flows={[flows[0]!]} flowId="source" value={[]} onChange={setValue} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Published snapshot · Read only</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={['handler']} disabled onChange={setValue} />
          </section>
        </div>
        <RunLinkContext.Provider value={({ flowId, runId }) => `?flow=${flowId}&run=${runId}`}>
          <section className="space-y-3">
            <h3>Error handling status</h3>
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'pending', flowId: 'handler' }] }} />
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'dispatched', flowId: 'handler', runId: 'handler-run' }] }} />
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'failed', flowId: 'handler', message: 'The error workflow is disabled.' }] }} />
            <ErrorHandling run={{ ...run, errorSource: { flowId: 'source', runId: 'source-run' } }} />
          </section>
        </RunLinkContext.Provider>
      </div>
    </I18nProvider>
  )
}

export const errorWorkflowStory: FrontendStory = {
  group: 'Trigger Error Trigger',
  id: 'error-workflow',
  title: 'Error handling',
  description:
    'Upstream picker: verify collapsed summaries, search, repeated selection, clearing, dismissal and focus return. Compare unavailable and read-only states.',
  standalone: true,
  render: (_log, dark, language) => <Sample dark={dark} language={language} />,
}
