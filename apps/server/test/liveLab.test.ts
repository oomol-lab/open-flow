import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { driver } from '../scripts/lab/driver.ts'
import { referenceLive } from '../scripts/lab/liveReference.ts'
import { LabSession } from '../scripts/lab/session.ts'

it('rejects unrelated Draft changes even when the published Webhook still executes correctly', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-live-lab-'))
  const lab = new LabSession(directory, 'webhook-live')
  try {
    await lab.open()
    const call = driver(lab, 'cli')
    await referenceLive(call, lab.manifest.flowId)
    const current = lab.current()
    const codeNodeId = Object.entries(current.content.document.graph.nodes).find(([, node]) => node.kind == 'task')![0]
    await call('flow_edit', {
      flowId: lab.manifest.flowId,
      baseRevision: current.revisionId,
      requestId: randomUUID(),
      edits: [{ op: 'text.set', node: codeNodeId, field: 'code', text: 'export default () => ({message: "unrelated edit"})' }],
    })
    const result = await lab.verify()
    expect(result.passed).toBe(false)
    expect(result.errors).toEqual([expect.stringContaining('preserve the rest of the published workflow')])
    expect(result.runIds).toHaveLength(1)
    expect(lab.service.control.runs.getRun('operator', result.runIds[0]!).status).toBe('completed')
  } finally {
    await lab.close()
    await rm(directory, { recursive: true, force: true })
  }
})
