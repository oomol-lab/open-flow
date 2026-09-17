import type { RunDetails, RunResult } from '../api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { RunsView } from './runsView.tsx'

describe('RunsView timeline', () => {
  it.each(['failed', 'running', 'waiting'] as const)('shows actions and results for a %s run', (status) => {
    const finishedAt = '2026-08-27T10:00:01.000Z'
    const run: RunDetails = {
      closureDigest: 'closure',
      engineContract: 'open-flow-engine/v5',
      engineDigest: 'engine',
      modelVersion: 2,
      revisionDigest: 'revision',
      waits:
        status == 'failed'
          ? []
          : [
              {
                actions: ['continue'],
                expiresAt: '2026-09-03T10:00:00.000Z',
                nodeId: 'wait',
                prompt: 'Review before continuing',
                waitId: 'wait',
                waitingSince: '2026-08-27T10:00:00.000Z',
              },
            ],
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
      status: 'failed',
      version: 1,
    }
    const store = {
      $: { runEventNodes: val<ReadonlyMap<number, string>>(new Map()) },
      runs: {
        $: {
          cancelingRunId: val<string | undefined>(),
          eventFilter: val('all' as const),
          events: val([]),
          eventsExpiresAt: val<string | undefined>(),
          filter: val({}),
          historyComplete: val(true),
          loadFailed: val(false),
          loading: val(false),
          loadMoreFailed: val(false),
          loadingMore: val(false),
          nextCursor: val<string | undefined>(),
          observationFailed: val(false),
          refreshing: val(false),
          resolvingActions: val(new Map()),
          result: val(status == 'failed' ? result : undefined),
          run: val(run),
          runs: val([run]),
        },
        cancel: vi.fn(),
        applyFilter: vi.fn(),
        loadMore: vi.fn(),
        retryLoad: vi.fn(),
        retryObservation: vi.fn(),
        select: vi.fn(),
        setEventFilter: vi.fn(),
      },
      workspace: { $: { revision: val(undefined) } },
    } as unknown as WorkbenchStore

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <RunsView onLocateEvent={() => undefined} onLocateWait={() => undefined} store={store} />
      </I18nProvider>,
    )

    if (status == 'failed') {
      expect(markup).toContain('binding.unresolved')
      expect(markup).toContain('Variable API_TOKEN could not be resolved.')
      expect(markup).not.toContain('>Continue<')
    } else {
      expect(markup).toContain('Review before continuing')
      expect(markup).toContain('>Continue<')
      expect(markup).toContain('Locate Wait node')
    }
    expect(markup).toContain('Timeline')
    expect(markup).toContain('Output')
    expect(markup).toContain('Filter runs')
  })
})
