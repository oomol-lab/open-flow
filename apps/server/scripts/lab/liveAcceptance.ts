import type { LabSession } from './session.ts'

import { isDeepStrictEqual } from 'node:util'

/** Verifies the published HTTP entry and execution, independently of the reference program. */
export async function verifyLiveWebhook(lab: LabSession, dynamic = false): Promise<{ errors: string[]; runIds: string[] }> {
  const started = performance.now()
  const errors: string[] = [],
    runIds: string[] = []
  const details = lab.service.control.getLiveDetails(lab.manifest.flowId, lab.manifest.origin)
  const entry = details.entries.find((item) => item.type == 'webhook')
  if (details.publication == null || details.status != 'runnable' || entry?.type != 'webhook') return { errors: ['Publish an enabled Webhook flow.'], runIds }
  if (entry.name != 'Published hook' || entry.config.method != 'POST' || entry.config.body.message?.nullable != false)
    errors.push('Published POST contract is incorrect.')
  if (
    dynamic &&
    !isDeepStrictEqual(entry.config.options, {
      responseData: 'accepted',
      responseBody: { kind: 'workflow-outputs', output: 'reply', timeoutMs: 15000 },
      responseStatusCode: 202,
      responseStatusCodeOutput: 'httpStatus',
    })
  )
    errors.push('Publish the selected reply output, 15-second timeout and preserved fixed text.')
  const published = lab.service.control.getRevision(lab.manifest.flowId, details.publication.revisionId).content
  const expectedDraft = structuredClone(published)
  Object.assign(expectedDraft.document.graph.nodes[entry.nodeId]!, { method: 'PUT', name: 'Draft hook' })
  if (!isDeepStrictEqual(lab.current().content, expectedDraft))
    errors.push('Change only the Webhook method to PUT and name to Draft hook; preserve the rest of the published workflow.')
  const url = entry.binding.endpointUrl
  if (url == null || new URL(url).origin != lab.manifest.origin) return { errors: [...errors, 'Missing local callback URL.'], runIds }
  const previous = new Set(lab.service.control.runs.listRuns(lab.manifest.flowId, 100, {}).page.runs.map((run) => run.runId))
  const response = await lab.app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'accepted published contract' }),
  })
  if (response.status != (dynamic ? 201 : 200)) errors.push(`Published callback returned ${response.status}.`)
  if (dynamic && ((await response.text()) != 'accepted published contract' || response.headers.get('content-type') != 'text/plain;charset=UTF-8'))
    errors.push('The published callback must return the workflow reply as plain text.')
  const admitted = lab.service.control.runs.listRuns(lab.manifest.flowId, 100, {}).page.runs.filter((run) => !previous.has(run.runId))
  if (admitted.length != 1) errors.push('Callback must admit exactly one Run.')
  for (const item of admitted) {
    let run = lab.service.control.runs.getRun(item.runId)
    const deadline = Date.now() + 20_000
    while (['queued', 'starting', 'running'].includes(run.status) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 30))
      run = lab.service.control.runs.getRun(item.runId)
    }
    runIds.push(run.runId)
    if (dynamic) {
      const result = lab.service.control.runs.getRunResult(run.runId)
      if (
        result.status != 'completed' ||
        !isDeepStrictEqual((result.result as { outputs?: unknown }).outputs, { reply: 'accepted published contract', httpStatus: 201 })
      )
        errors.push('Preserve the renamed workflow business output and mapping.')
    }
    if (
      run.status != 'completed' ||
      run.source != 'live' ||
      run.publicationId != details.publication.publicationId ||
      run.revisionId != details.publication.revisionId
    )
      errors.push('Callback did not complete against the published version.')
    const events = lab.service.control.runs.getRunEvents(run.runId, 0, 1000).events
    if (
      !events.some(
        (event) => event.kind == 'node.completed' && event.payload.nodeId != entry.nodeId && event.payload.outputs.message == 'accepted published contract',
      )
    )
      errors.push('Published execution did not return the callback message.')
  }
  lab.attempt.excluded!.push({
    kind: 'verification',
    sample: 'published-webhook',
    durationMs: performance.now() - started,
    ...(runIds[0] == null ? {} : { runId: runIds[0] }),
  })
  return { errors, runIds }
}
