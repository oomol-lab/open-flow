import type { ReadonlyVal } from 'value-enhancer'
import type { EventSource } from '../../../../control/common/api.ts'
import type { WaitAutoContinue } from '../../../../flow/common/change.ts'
import type { TaskCapability } from '../../../../flow/common/change.ts'
import type { Settings as NodeSettings } from '../../../../flow/common/nodeChanges.ts'
import type { GraphNode, InputPort, Port, JsonValue, TriggerSchedule } from '../api.ts'
import type { HttpParameterEdit, ConditionSettings, TaskPorts, FlowChanges, TaskSettings, ValueSettings, WebhookSettings } from '../editor/flowChanges.ts'
import type { PropertyDeletion } from '../editor/propertyDeletion.ts'
import type { RevisionView } from '../revisionView.ts'

import { dequal } from 'dequal/lite'
import {
  resetInputValues,
  setInputSources,
  updateTriggerSchedule,
  updateStartInputDefs,
  setConnectorConnection as changeConnectorConnection,
  setServiceConnections as changeServiceConnections,
  setCodeActions as changeCodeActions,
} from '../../../../flow/common/nodeChanges.ts'
import {
  updateHttpParameters,
  updateOutputPorts,
  updateCondition,
  updateTaskPorts,
  updateTaskAdditionalInputs,
  updateNodeDescription,
  updateNodeIcon,
  updateNodeSettings,
  updateNodeName,
  updateTask,
  updateValue,
  updateResolution,
  updateWebhook,
  updateTriggerConfig,
  setTriggerEventSource,
  setTriggerConnection as changeTriggerConnection,
  setInputVariable as changeInputVariable,
  setInputValue as changeInputValue,
} from '../editor/flowChanges.ts'

export class NodeEdits {
  public constructor(
    private readonly revision: ReadonlyVal<RevisionView | undefined>,
    private readonly save: (changes: FlowChanges, deletion?: PropertyDeletion) => Promise<boolean>,
    private readonly identity: () => string,
  ) {}

  public async saveErrorSources(nodeId: string, value: readonly string[]): Promise<boolean> {
    const node = this.revision.value?.graph()?.nodes[nodeId]
    if (node?.kind != 'error' || dequal(node.sourceFlowIds ?? [], value)) return false
    return await this.save([{ kind: 'graph.trigger.sources.set', nodeId, before: node.sourceFlowIds, value: value.length == 0 ? undefined : value }])
  }

  public async saveNodeSettings(nodeId: string, settings: NodeSettings): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateNodeSettings(revision, nodeId, settings)
    return changes != null && (await this.save(changes))
  }

  public async saveNodeDescription(nodeId: string, description: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateNodeDescription(revision, nodeId, description)
    return changes != null && (await this.save(changes))
  }

  public async saveNodeIcon(nodeId: string, icon: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateNodeIcon(revision, nodeId, icon)
    return changes != null && (await this.save(changes))
  }

  public async saveNodeTitle(nodeId: string, title: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateNodeName(revision, nodeId, title)
    return changes != null && (await this.save(changes))
  }

  public async setInputValue(nodeId: string, handle: string, value: JsonValue | undefined, deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = changeInputValue(revision, nodeId, handle, value)
    return changes != null && (await this.save(changes, deletion))
  }

  public async resetInputs(nodeId: string, handles: readonly string[]): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    return await this.save(resetInputValues(revision.revision.content, nodeId, handles))
  }

  public async saveOutputsDefs(
    nodeId: string,
    definitions: readonly InputPort[],
    deletion?: PropertyDeletion,
    values?: Readonly<Record<string, JsonValue | undefined>>,
  ): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null || revision.graph().nodes[nodeId]?.kind != 'outputs') return false
    return await this.save(updateOutputPorts(revision, nodeId, definitions, values), deletion)
  }

  public async saveStartInputDefs(nodeId: string, inputDefs: readonly Port[], deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null || revision.graph().nodes[nodeId]?.kind != 'start') return false
    const changes = updateStartInputDefs(revision.revision.content, nodeId, inputDefs)
    return await this.save(changes, deletion)
  }

  public async resetTriggerConfig(triggerId: string, names?: readonly string[]): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const trigger = revision.graph()?.nodes[triggerId]
    if (trigger?.kind !== 'poll' && trigger?.kind !== 'integration') return false
    const selected =
      names == null
        ? Object.entries(trigger.config)
        : names.flatMap((name) => (Object.hasOwn(trigger.config, name) ? [[name, trigger.config[name]] as const] : []))
    const changes = selected.map(([name, before]) => ({
      kind: 'graph.trigger.config.set' as const,
      nodeId: triggerId,
      name,
      before,
      value: undefined,
    }))
    return await this.save(changes)
  }

  public async setInputSource(
    nodeId: string,
    handle: string,
    source: { readonly nodeId: string; readonly output: string; readonly field?: string; readonly system?: true },
  ): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    return await this.save(setInputSources(revision.revision.content, nodeId, handle, [{ kind: 'node', ...source }]))
  }

  public async setInputVariable(nodeId: string, handle: string, name: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = name == null ? changeInputValue(revision, nodeId, handle, undefined) : changeInputVariable(revision, nodeId, handle, name, this.identity())
    return changes != null && (await this.save(changes))
  }

  public async saveCondition(nodeId: string, settings: ConditionSettings, deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateCondition(revision, nodeId, settings)
    return changes != null && (await this.save(changes, deletion))
  }

  public async saveValue(nodeId: string, values: readonly ValueSettings[], deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateValue(revision, nodeId, values)
    return changes != null && (await this.save(changes, deletion))
  }

  public async saveResolution(
    nodeId: string,
    settings: Pick<Extract<GraphNode, { readonly kind: 'approval' | 'wait' }>, 'prompt'> & {
      readonly name?: string
      readonly inputDefinitions?: readonly InputPort[]
      readonly autoContinue?: WaitAutoContinue | null
    },
    deletion?: PropertyDeletion,
    values?: Readonly<Record<string, JsonValue | undefined>>,
  ): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateResolution(revision, nodeId, settings, values)
    return changes != null && (await this.save(changes, deletion))
  }

  public async saveHttpParameters(nodeId: string, group: 'query' | 'headers', edit: HttpParameterEdit, deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateHttpParameters(revision, nodeId, group, edit, this.identity())
    return changes != null && this.save(changes, deletion)
  }

  public async saveTaskSettings(nodeId: string, settings: TaskSettings, deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateTask(revision, nodeId, settings)
    return changes != null && (await this.save(changes, deletion))
  }

  public async saveTaskPorts(
    nodeId: string,
    ports: TaskPorts,
    deletion?: PropertyDeletion,
    values?: Readonly<Record<string, JsonValue | undefined>>,
  ): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateTaskPorts(revision, nodeId, ports, values)
    return changes != null && (await this.save(changes, deletion))
  }

  public async saveTaskAdditionalInputs(
    nodeId: string,
    inputs: readonly InputPort[],
    deletion?: PropertyDeletion,
    values?: Readonly<Record<string, JsonValue | undefined>>,
  ): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateTaskAdditionalInputs(revision, nodeId, inputs, values)
    return changes != null && (await this.save(changes, deletion))
  }

  public async setConnectorConnection(nodeId: string, connectionId: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = changeConnectorConnection(revision.revision.content, nodeId, connectionId)
    return changes != null && (await this.save(changes))
  }

  public async setServiceConnections(providerId: string, connectionId: string | undefined, previousConnectionId?: ''): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = changeServiceConnections(revision.revision.content, providerId, connectionId, previousConnectionId)
    return changes.length == 0 || (await this.save(changes))
  }

  public async setCodeActions(nodeId: string, capabilities: readonly TaskCapability[]): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = changeCodeActions(revision.revision.content, nodeId, capabilities)
    return changes == null || (await this.save(changes))
  }

  public async setTriggerEventSource(triggerId: string, source: EventSource): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = setTriggerEventSource(revision, triggerId, source)
    return changes != null && (await this.save(changes))
  }

  public async saveTriggerConfig(triggerId: string, name: string, value: JsonValue | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateTriggerConfig(revision, triggerId, name, value)
    return changes != null && (await this.save(changes))
  }

  public async saveTriggerSchedule(triggerId: string, schedule: readonly TriggerSchedule[]): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateTriggerSchedule(revision.revision.content, triggerId, schedule)
    return changes != null && (await this.save(changes))
  }

  public async saveWebhook(triggerId: string, settings: WebhookSettings, deletion?: PropertyDeletion): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = updateWebhook(revision, triggerId, settings)
    return changes != null && (await this.save(changes, deletion))
  }

  public async setTriggerConnection(triggerId: string, connectionId: string | undefined): Promise<boolean> {
    const revision = this.revision.value
    if (revision == null) return false
    const changes = changeTriggerConnection(revision, triggerId, connectionId)
    return changes != null && (await this.save(changes))
  }
}
