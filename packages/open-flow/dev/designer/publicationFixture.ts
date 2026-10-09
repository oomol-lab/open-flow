import type { Draft, Presentation } from '../../src/workbench/browser/runtime/api.ts'

import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { setComment, setNodePositions } from '../../src/workbench/browser/runtime/canvasPresentation.ts'

export function publicationFixture(flowId: string, revisionId: string): { draft: Draft; presentation: Presentation } {
  const draft: Draft = {
    actorId: 'lab',
    createdAt: '2026-09-24T09:00:00.000Z',
    digest: 'lab',
    flowId,
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId,
    version: 1,
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {
        main: {
          imports: [],
          name: 'Prepare message',
          source: 'export default async function (inputs) {\n  return { message: `Welcome, ${inputs.customer.name}` };\n}\n',
        },
      },
      document: {
        bindings: { region: { kind: 'variable', target: 'REGION' } },
        tasks: {},
        graph: {
          nodes: {
            start: { kind: 'manual', name: 'Start onboarding' },
            customer: {
              kind: 'value',
              name: 'Customer details',
              description: 'Published customer configuration. Values and schemas remain inspectable without modifying the draft.',
              inputs: {},
              values: [
                {
                  handle: 'customer',
                  jsonSchema: { type: 'object' },
                  nullable: false,
                  value: {
                    name: 'Alex',
                    plan: 'Business',
                    preferences: { language: 'English', notifications: true },
                    notes: 'A long customer note for checking text selection, wrapping, scrolling and nested values in the historical inspector.',
                  },
                },
              ],
            },
            prepare: {
              kind: 'task',
              name: 'Prepare message',
              inputs: { customer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'customer', output: 'customer' }] } },
              task: {
                moduleId: 'main',
                name: 'Prepare message',
                inputs: [{ group: 'Customer' }, { handle: 'customer', jsonSchema: { type: 'object' }, nullable: false }],
                outputs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
              },
            },
            review: { kind: 'approval', name: 'Review message', inputs: {}, inputDefinitions: [], prompt: 'Approve the welcome message before sending.' },
          },
          edges: [
            { source: 'start', target: 'prepare' },
            { source: 'customer', target: 'prepare' },
            { source: 'prepare', target: 'review' },
          ],
        },
      },
    },
  }
  const positions = setNodePositions(
    {},
    { kind: 'flow' },
    { start: { x: 30, y: 20 }, customer: { x: 30, y: 210 }, prepare: { x: 470, y: 40 }, review: { x: 470, y: 370 } },
  )
  const value = setComment(positions, { kind: 'flow' }, 'note', {
    title: 'Release notes',
    content: 'Published onboarding flow.\n\nInspect configuration or drag nodes temporarily.',
    position: { x: 30, y: 510 },
  })
  return { draft, presentation: { revision: 1, updatedAt: draft.createdAt, value, version: 1 } }
}
