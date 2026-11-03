import type { FlowCanvasViewModel, FlowCanvasViewNode, FlowCanvasViewNodeRun } from '../../../src/canvas/browser/graph/FlowCanvas/model.ts'

export type ApplicationScenario = 'processing' | 'review' | 'disconnected' | 'failed' | 'configuration' | 'deferred'

export const applicationPositions: Readonly<Record<string, { x: number; y: number }>> = {
  intake: { x: 380, y: 0 },
  score: { x: 380, y: 145 },
  condition: { x: 380, y: 310 },
  priority: { x: 0, y: 550 },
  regular: { x: 380, y: 550 },
  review: { x: 760, y: 550 },
  archive: { x: 760, y: 820 },
  save: { x: 380, y: 820 },
  notify: { x: 380, y: 1010 },
}

const common = { inputs: [], outputs: [], position: { x: 0, y: 0 } } as const
const nodes: readonly FlowCanvasViewNode[] = [
  { ...common, id: 'intake', kind: 'trigger', title: 'New application', presentation: { kind: 'webhook', schedules: [] }, icon: ':lucide-light:webhook:' },
  {
    ...common,
    id: 'score',
    kind: 'task',
    title: 'Score application',
    reference: 'score',
    executorName: 'JavaScript',
    description: 'Calculate a score from the application details.',
  },
  {
    ...common,
    id: 'condition',
    kind: 'condition',
    title: 'Route by score',
    matchMode: 'first',
    defaultOutput: 'otherwise',
    outputs: ['priority', 'qualified', 'otherwise'].map((handle) => ({ handle })),
    cases: [
      { output: 'priority', groups: [{ expressions: [{ left: 'score', operator: '>=', right: '90' }] }] },
      { output: 'qualified', groups: [{ expressions: [{ left: 'score', operator: '>=', right: '70' }] }] },
    ],
  },
  {
    ...common,
    id: 'priority',
    kind: 'task',
    title: 'Join priority queue',
    reference: 'priority',
    executorName: 'CRM',
    icon: ':lucide-light:list-filter:',
    description: 'Assign a dedicated account team.',
  },
  {
    ...common,
    id: 'regular',
    kind: 'task',
    title: 'Create follow-up record',
    reference: 'regular',
    executorName: 'Connector · Database',
    icon: ':lucide-light:table:',
    description: 'Owner: Customer Success',
  },
  {
    ...common,
    id: 'review',
    kind: 'approval',
    title: 'Review application',
    description: 'Check the application details before continuing.',
    outputs: ['approve', 'reject', 'pending'].map((handle) => ({ handle })),
  },
  { ...common, id: 'archive', kind: 'outputs', title: 'Archive rejected application', icon: ':lucide-light:archive:' },
  {
    ...common,
    id: 'save',
    kind: 'task',
    title: 'Save application result',
    reference: 'save',
    executorName: 'JavaScript',
    description: 'Record how this application was handled.',
    icon: ':lucide-light:file-check:',
  },
  { ...common, id: 'notify', kind: 'task', title: 'Send notification', reference: 'notify', executorName: 'Connector · Email', icon: ':lucide-light:mail:' },
]

export const applicationEdges = [
  ['intake', 'score', '$out'],
  ['score', 'condition', '$out'],
  ['condition', 'priority', '$branch:priority'],
  ['condition', 'regular', '$branch:qualified'],
  ['condition', 'review', '$branch:otherwise'],
  ['priority', 'save', '$out'],
  ['regular', 'save', '$out'],
  ['review', 'save', '$branch:approve'],
  ['review', 'archive', '$branch:reject'],
  ['save', 'notify', '$out'],
].map(([source, target, sourceHandle]) => ({ id: `${source}-${target}`, source: source!, target: target!, sourceHandle: sourceHandle!, targetHandle: '$in' }))

export function applicationWorkflow(scenario: ApplicationScenario = 'processing', showRecords = true): FlowCanvasViewModel {
  return {
    direction: 'vertical',
    viewport: { x: 40, y: 30, zoom: 0.6 },
    edges: applicationEdges,
    runStatus: scenario === 'processing' || scenario === 'review' ? 'running' : 'idle',
    nodes: nodes.map((node) =>
      Object.assign({}, node, {
        position: applicationPositions[node.id]!,
        ...(node.kind === 'comment' ? {} : { run: showRecords ? runFor(node.id, scenario) : undefined }),
        ...(node.id === 'regular'
          ? { diagnostics: scenario === 'disconnected' ? 1 : 0, connectionRequired: scenario === 'disconnected', connectionDeferred: scenario === 'deferred' }
          : {}),
        ...(node.id === 'condition' ? { diagnostics: scenario === 'configuration' ? 1 : 0 } : {}),
      }),
    ),
  }
}

export function runFor(id: string, scenario: ApplicationScenario): FlowCanvasViewNodeRun | undefined {
  const reviewing = scenario === 'review'
  if (['priority', 'archive'].includes(id) || (id === 'review' && !reviewing) || (reviewing && ['regular', 'save', 'notify'].includes(id))) return undefined
  if (
    (scenario === 'failed' && id === 'notify') ||
    (scenario === 'deferred' && ['regular', 'save', 'notify'].includes(id)) ||
    (scenario === 'configuration' && ['condition', 'regular', 'save', 'notify'].includes(id))
  )
    return undefined
  const run: FlowCanvasViewNodeRun = {
    runId: scenario === 'disconnected' ? 'lab-vertical-previous-run' : 'lab-vertical-application',
    status: 'success',
    startedAt: '2026-11-03T02:00:00.000Z',
    finishedAt: '2026-11-03T02:00:00.018Z',
  }
  if (id === 'score')
    return {
      ...run,
      outputs: { score: reviewing ? 48 : 86, customer: 'Acme Studio' },
      logs: [{ time: run.finishedAt!, level: 'info', message: 'Calculated the application score.' }],
    }
  if (id === 'condition') return { ...run, outputs: { matched: [reviewing ? 'otherwise' : 'qualified'] } }
  if (id === 'regular')
    return {
      ...run,
      outputs: { recordId: 'application-42' },
      logs: scenario === 'disconnected' ? [{ time: run.finishedAt!, level: 'info', message: 'Created follow-up record application-42.' }] : undefined,
    }
  if (id === 'review') return { ...run, status: 'waiting', finishedAt: undefined, outputs: { pending: { url: 'https://example.com/approval/sample' } } }
  if (id === 'save' && scenario === 'failed')
    return {
      ...run,
      status: 'error',
      startedAt: '2026-11-03T02:00:00.030Z',
      finishedAt: '2026-11-03T02:00:00.042Z',
      successCount: 1,
      outputs: { recordId: 'application-42' },
      error: { name: 'Error', message: 'Failed to update the application result.' },
      logs: [
        { time: run.finishedAt!, level: 'info', message: 'Saved application-42.' },
        { time: '2026-11-03T02:00:00.042Z', level: 'error', message: 'Failed to update application-42. The notification step was not started.' },
      ],
    }
  if (id === 'save')
    return {
      ...run,
      successCount: 1,
      outputs: { recordId: 'application-42' },
      logs: [{ time: run.finishedAt!, level: 'info', message: 'Saved application-42.' }],
    }
  if (id === 'notify') return scenario === 'disconnected' ? run : { ...run, status: 'running', finishedAt: undefined, progress: 40 }
  return run
}
