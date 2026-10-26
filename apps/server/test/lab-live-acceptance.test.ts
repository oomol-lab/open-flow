import type { LabSession } from '../scripts/lab/session.ts'

import { expect, it, vi } from 'vitest'
import { verifyEarlyResponse } from '../scripts/lab/liveAcceptance.ts'

it('verifies concurrent early responses against newly admitted Runs only', async () => {
  let completed = false
  const listRuns = vi
    .fn()
    .mockReturnValueOnce({ page: { runs: [{ runId: 'previous' }] } })
    .mockReturnValue({ page: { runs: [{ runId: 'previous' }, { runId: 'accepted' }] } })
  const getRun = vi.fn((_actorId: string, _runId: string) => ({ status: completed ? 'completed' : 'waiting', waits: [{ waitId: 'wait' }] }))
  const resolveRunWait = vi.fn(() => {
    completed = true
  })
  const request = vi.fn(async () => new Response('accepted before waiting', { status: 201, headers: { 'X-Count': '3', 'X-Enabled': 'false' } }))
  const lab = {
    manifest: { flowId: 'flow', origin: 'http://localhost' },
    app: { request },
    attempt: { excluded: [] },
    service: {
      control: {
        publications: {
          getLiveDetails: () => ({
            publication: { revisionId: 'published' },
            entries: [
              {
                type: 'webhook',
                binding: { endpointUrl: 'http://localhost/hook' },
                config: { options: { responseBody: { kind: 'webhook-response', nodeId: 'reply' } } },
              },
            ],
          }),
        },
        drafts: {
          getRevision: () => ({
            content: { document: { graph: { nodes: { reply: { kind: 'webhook-response' }, other: { kind: 'webhook-response' } } } } },
          }),
        },
        runs: { listRuns, getRun, resolveRunWait },
      },
    },
  } as unknown as LabSession

  expect(await verifyEarlyResponse(lab)).toEqual({ errors: [], runIds: ['accepted'] })
  expect(resolveRunWait).toHaveBeenCalledExactlyOnceWith('operator', 'accepted', 'wait', 'continue')
  expect(getRun.mock.calls.every(([, runId]) => runId === 'accepted')).toBe(true)
  expect(request).toHaveBeenCalledTimes(3)
  expect(listRuns.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]!)
})
