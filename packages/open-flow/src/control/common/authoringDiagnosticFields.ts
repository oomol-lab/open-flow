import type { GraphNode, Group, InputPort, RevisionContent } from '../../flow/common/change.ts'

import { conditionConfigurationFieldPath } from './authoringCondition.ts'

type Ports = readonly (InputPort | Group)[]
const metadata = new Set(['name', 'description', 'icon', 'timeoutMs', 'maxExecutions'])

function portField(ports: Ports, path: readonly string[], parent: string): string {
  const port = ports[Number(path[0])]
  if (port == null || !('handle' in port)) return parent
  const field = `${parent}.${port.handle}`
  switch (path[1]) {
    case 'jsonSchema':
      return [field, 'schema', ...path.slice(2)].join('.')
    case 'value':
      return [field, 'default', ...path.slice(2)].join('.')
    case 'nullable':
    case 'description':
      return [field, ...path.slice(1)].join('.')
    default:
      return field
  }
}

/** Accept a decoded JSON Pointer, including or omitting its initial empty component. */
export function authoringDiagnosticField(_content: RevisionContent, node: GraphNode, parts: readonly string[]): string {
  const path = parts[0] == '' ? parts.slice(1) : parts
  if (path[0] == 'modules') return 'code'
  let location = path[0] == 'document' && path[1] == 'graph' && path[2] == 'nodes' ? path.slice(4) : path
  const inlineDefinition = node.kind == 'task' && location[0] == 'task'
  if (inlineDefinition) location = location.slice(1)
  if (location.length == 0) return 'config'
  const head = location[0]!
  if (!inlineDefinition && metadata.has(head)) return location.join('.')
  if (head == 'prompt') return 'prompt'
  if (head == 'inputs' && !inlineDefinition) {
    if (node.kind == 'condition' && location[1] != null) {
      const [branch, group, expression, side] = location[1].split('/')
      if (branch != null && group != null && expression != null && (side == 'left' || side == 'right'))
        return ['config', ...conditionConfigurationFieldPath(node, ['cases', branch, 'groups', group, 'expressions', expression, side])].join('.')
      return 'config.branches'
    }
    return location[1] == null ? 'inputs' : `inputs.${location[1]}`
  }
  if (node.kind == 'task') {
    const task = node.task
    if (task == null) return 'config'
    const executor = 'executor' in task ? task.executor : undefined
    if (head == 'additionalInputs') return portField(node.additionalInputs ?? [], location.slice(1), 'config.inputs')
    if (head == 'inputs' || head == 'outputs') {
      const ports = task[head]
      const port = ports[Number(location[1])]
      if (head == 'outputs' && (executor?.kind == 'agent' || executor?.kind == 'llm'))
        return location[2] == 'jsonSchema' ? ['config', 'resultSchema', ...location.slice(3)].join('.') : 'config.resultSchema'
      if (head == 'inputs' && executor?.kind == 'llm' && port != null && 'handle' in port && ['model', 'template', 'messages'].includes(port.handle))
        return ['config', port.handle, ...(location[2] == 'value' ? location.slice(3) : [])].join('.')
      const custom = executor == null || executor.kind == 'agent' || executor.kind == 'llm'
      return portField(ports, location.slice(1), custom ? `config.${head}` : head == 'inputs' ? 'inputPorts' : 'outputPorts')
    }
    if (head == 'executor') {
      const field = location[1]
      if (field == null || field == 'kind') return 'config'
      if (field == 'prompt') return 'prompt'
      if (executor?.kind == 'openapi') {
        if (field == 'document') return 'config'
        if (field == 'auth') return 'config.authentication'
      }
      if (executor?.kind == 'agent') {
        if (field == 'tools') {
          const tool = executor.tools[Number(location[2])]
          if (tool == null) return 'config.tools'
          const base = `config.tools.${location[2]}`
          if (location[3] == 'id') return base
          if (location[3] == 'inputs') {
            const input = tool.inputs[Number(location[4])]
            if (input == null) return `${base}.inputs`
            return location[5] == 'source' ? [base, 'inputs', input.handle, ...location.slice(6)].join('.') : `${base}.inputs.${input.handle}`
          }
        }
        if (field == 'notification' && location[2] == 'inputDefinitions') return 'config.notification.inputs'
      }
      return ['config', ...location.slice(1)].join('.')
    }
    if (head == 'capabilities') return ['config', ...location].join('.')
    if (head == 'name') return 'name'
    return 'config'
  }
  switch (node.kind) {
    case 'condition':
      return head == 'cases' || head == 'matchMode' ? ['config', ...conditionConfigurationFieldPath(node, location)].join('.') : 'config'
    case 'wait':
    case 'approval':
      return head == 'inputDefinitions' ? portField(node.inputDefinitions, location.slice(1), 'config.inputs') : 'config'
    case 'webhook':
      if (head == 'bodyFields') return portField(node.bodyFields, location.slice(1), 'config.body')
      return head == 'method' || head == 'options' ? ['config', ...location].join('.') : 'config'
    case 'value': {
      if (head != 'values') return 'config'
      const port = node.values[Number(location[1])]
      if (port == null) return 'config.values'
      if (location[2] == 'value') return ['config', 'values', port.handle, ...location.slice(3)].join('.')
      return portField(node.values, location.slice(1), 'config.outputs')
    }
    case 'cron':
      return head == 'cronTimes' ? ['config', 'schedule', ...location.slice(1)].join('.') : 'config'
    case 'poll':
    case 'integration':
      if (head == 'config') return location[1] == null ? 'inputs' : `inputs.${location[1]}`
      if (head == 'definition') return location[1] == 'configInputs' ? portField(node.definition.configInputs, location.slice(2), 'inputPorts') : 'config.key'
      if (head == 'pollTimes') return ['config', 'schedule', ...location.slice(1)].join('.')
      return head == 'connectionId' ? 'config.connectionId' : 'config'
    case 'error':
      return head == 'sourceFlowIds' ? ['config', ...location].join('.') : 'config'
    default:
      return 'config'
  }
}
