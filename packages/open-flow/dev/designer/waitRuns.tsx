import type { RunDetails, RunEvent } from '../../src/control/common/api.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunDrawer } from '../../src/workbench/browser/runtime/runs/runDrawer.tsx'
import { useStoryActions } from './storyActions.tsx'

const waits: RunDetails['waits'] = [
  {
    waitId: 'release',
    nodeId: 'release',
    actions: ['approve', 'reject'],
    prompt: 'Approve the release?',
    waitingSince: '2026-09-15T08:00:00Z',
    expiresAt: '2026-09-22T08:00:00Z',
  },
  {
    waitId: 'review',
    nodeId: 'review',
    actions: ['continue'],
    prompt: 'Continue after reviewing the report.',
    waitingSince: '2026-09-15T08:00:00Z',
    expiresAt: '2026-09-22T08:00:00Z',
  },
]
const base: RunDetails = {
  version: 1,
  runId: 'sample',
  flowId: 'flow',
  revisionId: 'revision',
  source: 'draft',
  status: 'running',
  createdAt: '2026-09-15T08:00:00Z',
  startedAt: '2026-09-15T08:00:00Z',
  closureDigest: 'lab',
  engineContract: 'open-flow-engine/v3',
  engineDigest: 'lab',
  modelVersion: 1,
  revisionDigest: 'lab',
  waits,
}

function WaitRuns({ language, log }: { readonly language: UiLanguage; readonly log: LogAction }) {
  const [pending, setPending] = useState(waits)
  useStoryActions([{ label: 'Reset approvals', onClick: () => setPending(waits) }])
  const states = [
    { title: 'Notification running · independent approvals', run: { ...base, waits: pending }, events: [] as RunEvent[] },
    { title: 'Frozen · all waits remain actionable', run: { ...base, status: 'waiting' as const }, events: [] as RunEvent[] },
    {
      title: 'Ordinary notification failure',
      run: { ...base, status: 'failed' as const, waits: [] },
      events: [
        {
          kind: 'node.failed',
          sequence: 1,
          createdAt: base.createdAt,
          payload: {
            executionId: 'send',
            scopeId: 'sample',
            flowId: 'flow',
            nodeId: 'send',
            error: { code: 'node.failed', message: 'Notification delivery failed.' },
          },
        },
      ] as RunEvent[],
    },
  ]
  return (
    <I18nProvider i18n={createI18n(language)}>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        {states.map(({ title, run, events }, index) => (
          <section key={title} className="open-flow-workbench min-w-0">
            <h3 className="mb-2 font-medium">{title}</h3>
            <RunDrawer
              cancelDisabled={false}
              canceling={false}
              events={events}
              eventsExpiresAt={undefined}
              eventFilter="all"
              eventNodes={new Map()}
              historyComplete
              onCancel={() => log('run.cancel', run.runId)}
              onClose={() => {}}
              onEventFilterChange={() => {}}
              onLocateEvent={() => {}}
              onLocateWait={(nodeId) => log('run.locate', nodeId)}
              onResolve={(waitId, action) => {
                log('wait.resolve', { waitId, action })
                if (index == 0) setPending((items) => items.filter((item) => item.waitId != waitId))
              }}
              onRetryObservation={() => {}}
              onToggle={() => {}}
              open
              observationFailed={false}
              result={undefined}
              resolvingActions={new Map()}
              run={run}
              submitting={false}
              visible
            />
          </section>
        ))}
      </div>
    </I18nProvider>
  )
}

export const waitRunsStory: FrontendStory = {
  group: 'Node Wait',
  id: 'wait-runs',
  title: 'Run decisions',
  standalone: true,
  description: 'Approve either wait independently while the notification branch continues. Frozen waits and ordinary notification failure are shown alongside.',
  render: (log, _dark, language) => <WaitRuns language={language} log={log} />,
}
