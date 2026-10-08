import type { ChangeOperation, RevisionContent, ManagedTaskDefinition } from '@oomol-lab/open-flow/flow-change'

import { applyFlowChanges, currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { isDeepStrictEqual } from 'node:util'

export const target = { kind: 'flow' } as const
const port = { jsonSchema: { type: 'string' }, nullable: false } as const
export const oldSource = 'export default async function () { return { text: "Original content", revised: "Original content" } }'
export const newSource = 'export default async function () { return { text: "Original content", revised: "Weekly summary: 3 updates" } }'
export const taskPrompt = "Summarize this week's updates in English, preserving all numbers."
export const scenarios = [
  {
    id: 'edit-prompt',
    name: 'Edit an Agent prompt',
    version: 2,
    task: `Find the Weekly summary Agent and change its prompt to "${taskPrompt}". Leave all other settings unchanged.`,
    expectedText: null,
  },
  {
    id: 'fix-notification',
    name: 'Fix the notification source',
    version: 2,
    task: 'Send notification should use the text output of Format message. Fix the input source without changing the execution order or other settings.',
    expectedText: 'Original content',
  },
  {
    id: 'edit-code',
    name: 'Update code and downstream input',
    version: 2,
    task: 'Make Format message return "Weekly summary: 3 updates" in its revised output, preserve its text output, and use revised as the notification input. Leave all other settings unchanged.',
    expectedText: 'Weekly summary: 3 updates',
  },
  {
    id: 'create-flow',
    name: 'Create a flow',
    version: 2,
    task: 'In the empty flow, add a Manual trigger and the Send notification action from Lab Notifications. Select Lab account and send "Hello Lab". Connect the execution path and verify the run.',
    expectedText: 'Hello Lab',
  },
] as const
export type Scenario = (typeof scenarios)[number]
export function scenario(id: string): Scenario {
  const value = scenarios.find((item) => item.id == id)
  if (value == null) throw new Error(`Unknown scenario: ${id}`)
  return value
}
export function initialOperations(id: string): ChangeOperation[] {
  if (id == 'create-flow') return []
  const agent: ManagedTaskDefinition = {
    name: 'Weekly summary',
    inputs: [],
    outputs: [{ handle: 'output', ...port }],
    executor: { kind: 'agent', code: true, model: 'lab-model', prompt: 'Summarize updates.', maxRounds: 3, tools: [] },
  }
  return [
    { kind: 'graph.node.create', target, nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
    { kind: 'task.create', taskId: 'summary-task', task: agent },
    { kind: 'graph.node.create', target, nodeId: 'summary', node: { kind: 'task', name: 'Weekly summary', taskId: 'summary-task', inputs: {} } },
    { kind: 'task.create', taskId: 'archive-task', task: { ...agent, name: 'Archive summary' } },
    { kind: 'graph.node.create', target, nodeId: 'archive', node: { kind: 'task', name: 'Archive summary', taskId: 'archive-task', inputs: {} } },
    { kind: 'module.create', moduleId: 'format-module', module: { name: 'Format message', source: oldSource, imports: [] } },
    {
      kind: 'graph.node.create',
      target,
      nodeId: 'format',
      node: {
        kind: 'task',
        name: 'Format message',
        inputs: {},
        task: {
          name: 'Format message',
          moduleId: 'format-module',
          inputs: [],
          outputs: [
            { handle: 'text', ...port },
            { handle: 'revised', ...port },
          ],
          capabilities: [],
        },
      },
    },
    ...notificationOperations(),
    { kind: 'graph.edge.connect', target, edge: { source: 'start', target: 'format' } },
    { kind: 'graph.edge.connect', target, edge: { source: 'format', target: 'notify' } },
    { kind: 'graph.edge.connect', target, edge: { source: 'start', target: 'summary' } },
  ]
}
export function notificationOperations(): ChangeOperation[] {
  return [
    {
      kind: 'task.create',
      taskId: 'notify-task',
      task: {
        name: 'Send notification',
        inputs: [{ handle: 'text', ...port }],
        outputs: [{ handle: 'receipt', ...port }],
        executor: { kind: 'connector', action: 'lab-notifications.send', connectionId: 'lab-account' },
      },
    },
    {
      kind: 'graph.node.create',
      target,
      nodeId: 'notify',
      node: { kind: 'task', name: 'Send notification', taskId: 'notify-task', inputs: { text: { kind: 'value', value: 'Wrong source' } } },
    },
  ]
}
export function referenceChanges(id: string, content: RevisionContent): ChangeOperation[] {
  if (id == 'edit-prompt') {
    const before = content.document.tasks['summary-task']!
    if (before.executor.kind != 'agent') throw new Error('Expected Agent')
    return [{ kind: 'task.agent.set', taskId: 'summary-task', before, value: { ...before, executor: { ...before.executor, prompt: taskPrompt } } }]
  }
  const notify = content.document.graph.nodes.notify
  if (id == 'create-flow')
    return [
      { kind: 'graph.node.create', target, nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
      ...notificationOperations(),
      {
        kind: 'graph.node.input.set',
        target,
        nodeId: 'notify',
        handle: 'text',
        before: { kind: 'value', value: 'Wrong source' },
        value: { kind: 'value', value: 'Hello Lab' },
      },
      { kind: 'graph.edge.connect', target, edge: { source: 'start', target: 'notify' } },
    ]
  if (notify?.kind != 'task') throw new Error('Missing notify node')
  return [
    ...(id == 'edit-code'
      ? [
          {
            kind: 'module.source.replace' as const,
            moduleId: 'format-module',
            beforeSource: content.modules['format-module']!.source,
            beforeImports: content.modules['format-module']!.imports,
            source: newSource,
            imports: [],
          },
        ]
      : []),
    {
      kind: 'graph.node.input.set',
      target,
      nodeId: 'notify',
      handle: 'text',
      before: notify.inputs.text,
      value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'format', output: id == 'edit-code' ? 'revised' : 'text' }] },
    },
  ]
}
export const emptyContent: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, tasks: {}, subflows: {}, graph: { nodes: {}, edges: [] } },
}
/** Checks intent and preservation independently from the reference command sequence. */
export function assertions(id: string, base: RevisionContent, current: RevisionContent): string[] {
  const errors: string[] = []
  const preserved = structuredClone(current)
  if (id == 'edit-prompt') {
    const task = current.document.tasks['summary-task']
    if (task?.executor.kind != 'agent' || task.executor.prompt != taskPrompt) errors.push('Weekly summary prompt does not match the requested text.')
    Object.assign(preserved.document.tasks, { 'summary-task': base.document.tasks['summary-task'] })
    // Restore only the allowed field, so other changes to this Task remain detectable.
    if (task?.executor.kind == 'agent')
      Object.assign(preserved.document.tasks, { 'summary-task': { ...task, executor: { ...task.executor, prompt: 'Summarize updates.' } } })
  } else if (id == 'create-flow') {
    const nodes = Object.values(current.document.graph.nodes)
    if (!nodes.some((node) => node.kind == 'manual')) errors.push('A Manual trigger is required.')
    if (
      !Object.values(current.document.tasks).some(
        (task) => task.executor.kind == 'connector' && task.executor.action == 'lab-notifications.send' && task.executor.connectionId == 'lab-account',
      )
    )
      errors.push('Select lab-notifications.send with Lab account.')
    return errors
  } else {
    const node = current.document.graph.nodes.notify
    const expected = { kind: 'sources', sources: [{ kind: 'node', nodeId: 'format', output: id == 'edit-code' ? 'revised' : 'text' }] }
    if (node?.kind != 'task' || !isDeepStrictEqual(node.inputs.text, expected))
      errors.push('Notification input must reference the requested Format message output.')
    if (node?.kind == 'task') {
      const before = base.document.graph.nodes.notify
      if (before?.kind == 'task') Object.assign(preserved.document.graph.nodes, { notify: { ...node, inputs: { ...node.inputs, text: before.inputs.text } } })
    }
    if (id == 'edit-code') {
      const module = current.modules['format-module']
      if (module == null || module.source == base.modules['format-module']!.source) errors.push('Format message code was not changed.')
      if (module != null) Object.assign(preserved.modules, { 'format-module': { ...module, source: base.modules['format-module']!.source } })
    }
  }
  if (!isDeepStrictEqual(base, preserved)) errors.push('Content outside the requested edit changed.')
  return errors
}
export function initialContent(id: string) {
  return applyFlowChanges(emptyContent, initialOperations(id))
}
