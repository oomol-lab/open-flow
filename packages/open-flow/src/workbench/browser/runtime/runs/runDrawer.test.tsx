import type { Run, RunDetails, RunResult } from '../api.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { RunDrawer } from './runDrawer.tsx'

function renderFailure(status: 'failed' | 'indeterminate'): string {
  const finishedAt = '2026-08-27T10:00:01.000Z'
  const run: Run = {
    createdAt: '2026-08-27T10:00:00.000Z',
    finishedAt,
    flowId: 'flow',
    revisionId: 'revision',
    runId: 'run',
    source: 'draft',
    status,
    version: 1,
  }
  const result: RunResult = {
    error: { code: 'binding.unresolved', message: 'Variable API_TOKEN could not be resolved.' },
    finishedAt,
    runId: run.runId,
    status,
    version: 1,
  }
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <RunDrawer
        cancelDisabled={false}
        canceling={false}
        eventFilter="all"
        eventNodes={new Map()}
        events={[]}
        eventsExpiresAt={undefined}
        historyComplete
        observationFailed={false}
        onCancel={() => undefined}
        onClose={() => undefined}
        onEventFilterChange={() => undefined}
        onLocateEvent={() => undefined}
        onLocateWait={() => undefined}
        onResolve={() => undefined}
        onRetryObservation={() => undefined}
        onToggle={() => undefined}
        open
        result={result}
        resolvingAction={undefined}
        run={run}
        submitting={false}
        visible
      />
    </I18nProvider>,
  )
}

describe('RunDrawer terminal result', () => {
  it.each(['failed', 'indeterminate'] as const)('shows the final %s error', (status) => {
    const markup = renderFailure(status)

    expect(markup).toContain('run-log-result danger')
    expect(markup).toContain('binding.unresolved')
    expect(markup).toContain('Variable API_TOKEN could not be resolved.')
  })

  it('shows the active Wait prompt, fixed actions, expiry, and locate action', () => {
    const run: RunDetails = {
      closureDigest: 'closure',
      createdAt: '2026-08-27T10:00:00.000Z',
      engineContract: 'open-flow-engine/v1',
      engineDigest: 'sha256:engine',
      flowId: 'flow',
      modelVersion: 1,
      revisionDigest: 'sha256:revision',
      revisionId: 'revision',
      runId: 'run',
      source: 'draft',
      startedAt: '2026-08-27T10:00:01.000Z',
      status: 'waiting',
      version: 1,
      waiting: {
        actions: ['approve', 'reject'],
        expiresAt: '2026-09-03T10:00:02.000Z',
        nodeId: 'approval',
        prompt: 'Approve the production release?',
        waitId: '123456789012345678901',
        waitingSince: '2026-08-27T10:00:02.000Z',
      },
    }
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <RunDrawer
          cancelDisabled={false}
          canceling={false}
          eventFilter="all"
          eventNodes={new Map()}
          events={[]}
          eventsExpiresAt={undefined}
          historyComplete
          observationFailed={false}
          onCancel={() => undefined}
          onClose={() => undefined}
          onEventFilterChange={() => undefined}
          onLocateEvent={() => undefined}
          onLocateWait={() => undefined}
          onResolve={() => undefined}
          onRetryObservation={() => undefined}
          onToggle={() => undefined}
          open
          result={undefined}
          resolvingAction={undefined}
          run={run}
          submitting={false}
          visible
        />
      </I18nProvider>,
    )

    if (run.waiting == null) throw new Error('Waiting fixture is missing.')
    expect(markup).toContain('Approve the production release?')
    expect(markup).toContain(`Expires ${new Date(run.waiting.expiresAt).toLocaleString('en')}`)
    expect(markup).toContain('>Approve<')
    expect(markup).toContain('>Reject<')
    expect(markup).toContain('Locate Wait node')
  })
})
