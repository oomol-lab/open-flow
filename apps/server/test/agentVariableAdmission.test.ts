import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

/** An Agent Run whose closure reads a deployment Variable. */
function revision(): RevisionContent {
  return {
    modelVersion: 1,
    modules: {},
    document: {
      bindings: { email: { kind: 'variable', target: 'TOKEN' } },
      subflows: {},
      tasks: {
        agent: {
          name: 'Agent',
          inputs: [{ handle: 'email', jsonSchema: { type: 'string' }, nullable: false }],
          outputs: [{ handle: 'output', jsonSchema: { type: 'string' }, nullable: false }],
          executor: { kind: 'agent', model: 'fixture', prompt: { kind: 'value', value: 'Go.' }, system: 'Help.', maxRounds: 3, tools: [] },
        },
      },
      graph: {
        edges: [{ source: 'trigger', target: 'agent' }],
        nodes: {
          trigger: { kind: 'manual', name: 'Start' },
          agent: {
            kind: 'task',
            name: 'Agent',
            taskId: 'agent',
            inputs: { email: { kind: 'sources', sources: [{ bindingId: 'email', kind: 'binding' }] } },
          },
        },
      },
    },
  }
}

describe('Agent Run admission with a deployment Variable', () => {
  it('admits the Run and fixes the resolved Variable inside the same transaction', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-agent-variable-'))
    const database = Database.open(path.join(directory, 'store.sqlite'))
    const store = new Store(database, Date.now, undefined, undefined, () => ({ model: 'fixture', origin: 'https://llm.example', token: 'token' }))
    try {
      store.flows.createFlow({
        actorId: 'operator',
        content: new TextDecoder().decode(encodeRevision(revision())),
        createdAt: Date.now(),
        digest: 'revision',
        flowId: 'flow',
        idempotencyKey: 'flow',
        name: 'Agent Variable',
        requestDigest: 'flow',
        revisionId: 'revision',
      })
      store.variables.put('TOKEN', 'secret')

      const result = store.runs.acceptControlRun({
        closureDigest: 'closure',
        flowId: 'flow',
        idempotencyKey: 'run',
        inputs: {},
        modelVersion: 1,
        requestDigest: 'run',
        revisionDigest: 'revision',
        revisionId: 'revision',
        trigger: { nodeId: 'trigger', payload: {} },
        variableNames: ['TOKEN'],
      })

      expect(result).toMatchObject({ created: true, kind: 'accepted' })
      if (result.kind != 'accepted') throw new Error('Run was not accepted.')
      const row = database.connection
        .prepare('SELECT binding_values AS bindingValues, llm_config AS llmConfig FROM runs WHERE run_id = ?')
        .get(result.runId) as {
        readonly bindingValues: string | null
        readonly llmConfig: string | null
      }
      expect(JSON.parse(row.bindingValues ?? 'null')).toEqual({ email: 'secret' })
      expect(JSON.parse(row.llmConfig ?? 'null')).toMatchObject({ model: 'fixture' })
    } finally {
      database.close()
      await rm(directory, { force: true, recursive: true })
    }
  })
})
