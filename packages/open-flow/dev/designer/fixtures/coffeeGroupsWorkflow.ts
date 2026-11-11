import type { FlowCanvasViewModel, FlowCanvasViewNode } from '../../../src/canvas/browser/graph/FlowCanvas/model.ts'

// Execution graph from awesome-workflow-templates at f2bf5895d91486412f320151dafd9c6b95b42091.
const common = { inputs: [], outputs: [], position: { x: 0, y: 0 } } as const
const task = (id: string, title: string): FlowCanvasViewNode => ({ ...common, id, title, kind: 'task', reference: id, executorName: 'JavaScript' })
const condition = (id: string, title: string, output: string): FlowCanvasViewNode => ({
  ...common,
  id,
  title,
  kind: 'condition',
  matchMode: 'first',
  defaultOutput: 'otherwise',
  outputs: [{ handle: output }, { handle: 'otherwise' }],
  cases: [{ output, groups: [{ expressions: [{ left: 'more', operator: '==', right: 'true' }] }] }],
})

export const coffeeGroupsWorkflow: FlowCanvasViewModel = {
  direction: 'vertical',
  viewport: { x: 40, y: 30, zoom: 0.6 },
  nodes: [
    { ...common, id: 'schedule', title: 'Every Monday at 10 UTC', kind: 'trigger', presentation: { kind: 'cron', schedules: [] } },
    task('configure', 'Configure the coffee session'),
    task('greet', 'Greet the channel'),
    task('collect', 'Collect channel members'),
    condition('pages', 'More member pages', 'more'),
    task('read', 'Read channel members'),
    task('shuffle', 'Shuffle and form groups'),
    task('prepare', 'Prepare each group'),
    condition('remaining', 'Any groups remaining', 'more'),
    condition('route', 'Announce or invite', 'announce'),
    task('announce', 'Announce the group'),
    task('invite', 'Create the group invitation'),
    { ...common, id: 'done', title: 'Groups processed', kind: 'outputs' },
  ],
  edges: [
    ['schedule', 'configure'],
    ['configure', 'greet'],
    ['greet', 'collect'],
    ['collect', 'pages'],
    ['pages', 'read', 'more'],
    ['read', 'collect'],
    ['pages', 'shuffle', 'otherwise'],
    ['shuffle', 'prepare'],
    ['prepare', 'remaining'],
    ['remaining', 'route', 'more'],
    ['remaining', 'done', 'otherwise'],
    ['route', 'announce', 'announce'],
    ['announce', 'prepare'],
    ['route', 'invite', 'otherwise'],
    ['invite', 'prepare'],
  ].map(([source, target, branch]) => ({
    id: `${source}-${target}`,
    source: source!,
    target: target!,
    sourceHandle: branch ? `$branch:${branch}` : '$out',
    targetHandle: '$in',
  })),
}
