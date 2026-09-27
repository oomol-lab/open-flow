import type { Run, RunDetails, RunEvent, RunResult } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { RunDrawer, RunLog, useRunLogPresentation } from './runDrawer.tsx'

function renderFailure(
  status: 'failed' | 'indeterminate',
  events: readonly RunEvent[] = [],
  open = true,
  completion?: RunResult | null,
  eventFilter: 'all' | 'output' = 'all',
): string {
  const finishedAt = '2026-08-27T10:00:01.000Z'
  const run: Run = {
    createdAt: '2026-08-27T10:00:00.000Z',
    finishedAt,
    flowId: 'flow',
    revisionId: 'revision',
    runId: 'run',
    source: 'draft',
    status: completion?.status ?? status,
    version: 1,
  }
  const result: RunResult | undefined =
    completion === null
      ? undefined
      : (completion ?? {
          error: { code: 'binding.unresolved', message: 'Variable API_TOKEN could not be resolved.' },
          finishedAt,
          runId: run.runId,
          status,
          version: 1,
        })
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <RunDrawer
        onOpenRuns={() => undefined}
        cancelDisabled={false}
        canceling={false}
        eventFilter={eventFilter}
        eventNodes={new Map()}
        events={events}
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
        open={open}
        result={result}
        resolvingActions={new Map()}
        run={run}
        submitting={false}
      />
    </I18nProvider>,
  )
}

describe('RunDrawer terminal result', () => {
  it('hides the log panel completely when collapsed', () => {
    expect(renderFailure('failed', [], false)).toBe('')
  })

  it('keeps the panel height stable as logs accumulate and places the view switch in the header', () => {
    const events: RunEvent[] = Array.from({ length: 100 }, (_, sequence) => ({
      sequence,
      createdAt: '2026-08-27T10:00:00.000Z',
      kind: 'node.log',
      payload: { flowId: 'flow', scopeId: 'root', nodeId: 'node', executionId: 'execution', level: 'info', message: 'Log entry' },
    }))
    const empty = renderFailure('failed')
    const populated = renderFailure('failed', events)
    expect(empty.match(/class="run-drawer"[^>]*style="([^"]+)"/)?.[1]).toBe('height:360px')
    expect(populated.match(/class="run-drawer"[^>]*style="([^"]+)"/)?.[1]).toBe('height:360px')
    expect(populated.match(/<header class="run-header">[\s\S]*?<\/header>/)?.[0]).toContain('Execution overview')
  })

  it('bounds the initial rendered window for a large log history', () => {
    const events: RunEvent[] = Array.from({ length: 10_000 }, (_, index) => ({
      sequence: index + 1,
      createdAt: '2026-08-27T10:00:00.000Z',
      kind: 'node.log',
      payload: { flowId: 'flow', scopeId: 'root', nodeId: 'node', executionId: 'execution', level: 'info', message: `Virtual log ${index}` },
    }))
    const markup = renderFailure('failed', events)
    expect(markup).toContain('Virtual log 0')
    expect(markup).not.toContain('Virtual log 9999')
    expect(markup.match(/Virtual log /g)!.length).toBeLessThan(100)
  })

  it('defaults to the chronological timeline without moving interleaved messages into node groups', () => {
    const events: RunEvent[] = ['a', 'b', 'a'].map((executionId, index) => ({
      sequence: index + 1,
      createdAt: '2026-08-27T10:00:00.000Z',
      kind: 'node.log',
      payload: { executionId, scopeId: 'root', flowId: 'flow', nodeId: executionId, level: 'info', message: `Interleaved message ${index + 1}` },
    }))
    const markup = renderFailure('failed', events)
    expect(markup.indexOf('Interleaved message 1')).toBeLessThan(markup.indexOf('Interleaved message 2'))
    expect(markup.indexOf('Interleaved message 2')).toBeLessThan(markup.indexOf('Interleaved message 3'))
    expect(markup).not.toContain('View in timeline')
  })

  it.each(['failed', 'indeterminate'] as const)('shows the final %s error', (status) => {
    const markup = renderFailure(status)

    expect(markup).toContain('binding.unresolved')
    expect(markup).toContain('Variable API_TOKEN could not be resolved.')
  })

  it('shows the active Wait prompt, fixed actions, expiry, and locate action', () => {
    const run: RunDetails = {
      closureDigest: 'closure',
      createdAt: '2026-08-27T10:00:00.000Z',
      engineContract: 'open-flow-engine/v5',
      engineDigest: 'sha256:engine',
      flowId: 'flow',
      modelVersion: currentFlowModelVersion,
      sharedAccessDigest: 'implicit:test',
      revisionDigest: 'sha256:revision',
      revisionId: 'revision',
      runId: 'run',
      source: 'draft',
      startedAt: '2026-08-27T10:00:01.000Z',
      status: 'waiting',
      version: 1,
      waits: [
        {
          actions: ['approve', 'reject'],
          expiresAt: '2026-09-03T10:00:02.000Z',
          nodeId: 'approval',
          prompt: 'Approve the production release?',
          waitId: '123456789012345678901',
          waitingSince: '2026-08-27T10:00:02.000Z',
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <RunDrawer
          onOpenRuns={() => undefined}
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
          open
          result={undefined}
          resolvingActions={new Map()}
          run={run}
          submitting={false}
        />
      </I18nProvider>,
    )

    if (run.waits[0] == null) throw new Error('Waiting fixture is missing.')
    expect(markup).toContain('Approve the production release?')
    expect(markup).toContain(`Expires ${new Date(run.waits[0]!.expiresAt).toLocaleString('en')}`)
    expect(markup).toContain('>Approve<')
    expect(markup).toContain('>Reject<')
    expect(markup).toContain('Locate Wait node')
  })
})

it.each(['all', 'output', 'lifecycle'] as const)('shows all final handles once in the %s event filter', (eventFilter) => {
  const events: RunEvent[] = [
    {
      createdAt: '2026-09-05T10:00:00.000Z',
      kind: 'node.completed',
      payload: { flowId: 'flow', scopeId: 'scope', nodeId: 'source', executionId: 'execution', outputs: { first: 17, second: 29 } },
      sequence: 1,
    },
  ]
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <RunDrawer
        onOpenRuns={() => undefined}
        cancelDisabled={false}
        canceling={false}
        eventFilter={eventFilter}
        eventNodes={new Map()}
        events={events}
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
        open
        result={undefined}
        resolvingActions={new Map()}
        run={undefined}
        submitting={false}
      />
    </I18nProvider>,
  )
  expect(markup).toContain('first')
  expect(markup).toContain('second')
  expect(markup).toContain('17')
  expect(markup).toContain('29')
  expect(markup.match(/title="node.completed"/g)).toHaveLength(1)
})

it.each(['all', 'output'] as const)('renders the Flow completion result once with the %s filter, even before the result request completes', (filter) => {
  const result: RunResult = {
    version: 1,
    runId: 'run',
    status: 'completed',
    finishedAt: '2026-08-27T10:00:01.000Z',
    result: { kind: 'function-outputs', outputs: { answer: 'flow-answer', nested: { value: 42 } } },
  }
  const event: RunEvent = { sequence: 1, createdAt: result.finishedAt, kind: 'run.completed', payload: { result: result.result } }
  for (const completion of [result, null]) {
    const markup = renderFailure('failed', [event], true, completion, filter)
    expect(markup).toContain('flow-answer')
    expect(markup.match(/>Flow result</g)).toHaveLength(1)
    expect(markup).toContain('Completed')
  }
  const fallback = renderFailure('failed', [], true, result, filter)
  expect(fallback).toContain('flow-answer')
  expect(fallback.match(/>Flow result</g)).toHaveLength(1)
})

it.each([true, false])('shows Flow duration in overview with completion event: %s', (hasEvent) => {
  const result: Extract<RunResult, { status: 'completed' }> = {
    version: 1,
    runId: 'run',
    status: 'completed',
    finishedAt: '2026-08-27T10:00:02.000Z',
    result: { answer: 'done' },
  }
  const run: Run = {
    version: 1,
    runId: 'run',
    flowId: 'flow',
    revisionId: 'revision',
    source: 'draft',
    status: 'completed',
    createdAt: '2026-08-27T10:00:00.000Z',
    startedAt: '2026-08-27T10:00:01.000Z',
    finishedAt: result.finishedAt,
  }
  function Overview() {
    const presentation = useRunLogPresentation('all', run.runId)
    return (
      <RunLog
        presentation={{ ...presentation, view: 'overview' }}
        events={hasEvent ? [{ sequence: 1, createdAt: result.finishedAt, kind: 'run.completed', payload: { result: result.result } }] : []}
        eventsExpiresAt={undefined}
        eventNodes={new Map()}
        historyComplete
        observationFailed={false}
        onLocateEvent={() => undefined}
        onRetryObservation={() => undefined}
        result={result}
        run={run}
        submitting={false}
      />
    )
  }
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <Overview />
    </I18nProvider>,
  )
  expect(markup).toContain('>1s</span>')
  expect(markup).not.toContain('+0.0s')
  expect(markup).not.toContain('<time')
  expect(markup).toContain('Flow run')
  expect(markup).toContain('Completed')
  expect(markup).toContain('done')
})
