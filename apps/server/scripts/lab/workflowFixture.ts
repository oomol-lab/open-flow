import type { ServerService } from '../../node/application/service.ts'
export async function seedWorkflowTarget(service: ServerService) {
  const created = await service.control.flows.createFlow('operator', 'Lab double', 'lab-call-target')
  const flowId = created.flow.flowId
  const edited = await service.control.drafts.editAuthoring('operator', flowId, {
    baseRevision: created.flow.draftRevisionId,
    requestId: 'lab-call-target',
    edits: [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start', config: { inputDefs: { amount: { schema: { type: 'number' }, nullable: false } } } },
      {
        op: 'node.add',
        as: 'code',
        type: 'code',
        name: 'Double',
        code: 'export default ({amount}) => { console.log("child-only"); return {total: amount * 2} }',
        config: { outputs: { total: { schema: { type: 'number' }, nullable: false } } },
        inputs: { amount: { kind: 'output', node: '$start', port: 'amount' } },
      },
      {
        op: 'node.add',
        as: 'outputs',
        type: 'outputs',
        name: 'Outputs',
        inputs: { total: { kind: 'output', node: '$code' } },
        config: { outputDefs: { total: { schema: { type: 'number' }, nullable: false } } },
      },
      { op: 'edge.connect', source: '$start', target: '$code' },
      { op: 'edge.connect', source: '$code', target: '$outputs' },
    ],
  })
  const revision = service.control.drafts.getRevision('operator', flowId, edited.revision)
  const result = await service.publisher.publish({
    control: { actorId: 'operator', operation: 'publish' },
    flowId,
    revision: revision.content,
    revisionId: revision.revisionId,
    expectedLivePublicationId: null,
    idempotencyKey: 'lab-call-publish',
  })
  if (result.kind != 'published') throw new Error('Could not publish Lab workflow target')
}
