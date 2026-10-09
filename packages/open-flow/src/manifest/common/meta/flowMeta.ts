import type { ReadonlyVal } from 'value-enhancer'
import type { ResourceUriResolver } from '../../../base/common/resource.ts'
import type {
  HandleName,
  InputHandleDef,
  OutputHandleDef,
  TriggerDefinition,
  TriggerDefinitionSnapshot,
  TriggerDescriptor,
  TriggerNode,
} from '../../../schema/index.ts'
import type { FlowEditOperation } from '../flowEdit.ts'
import type { FlowName, FlowPath, SearchPath } from '../manifestTypes.ts'
import type { WritableFlowManifest } from '../writable/writableFlowManifest.ts'
import type { FlowLikeMeta$ } from './flowLike/flowLikeMeta.ts'
import type { FlowLikeMetaKind } from './flowLike/internal.ts'
import type { NodeMeta, ResolveSharedBlockMeta$ } from './nodeMeta.ts'
import type { PackageMeta } from './package/packageMeta.ts'

import { inertFilter, noop } from '@wopjs/cast'
import { arrayShallowEqual, attachSetter, combine, derive, val } from 'value-enhancer'
import { applyFlowEditOperations } from '../flowEdit.ts'
import { getHandleNames } from '../model/block/base/blockManifest.ts'
import { WritableTriggerNodeManifest } from '../writable/node/writableTriggerNodeManifest.ts'
import { FlowLikeMeta, isFlowLikeMeta } from './flowLike/flowLikeMeta.ts'

export interface FlowMeta$ extends FlowLikeMeta$ {
  readonly icon: ReadonlyVal<string | undefined>
  readonly title: ReadonlyVal<string | undefined>
  readonly detail: ReadonlyVal<string | undefined>
  readonly description: ReadonlyVal<string | undefined>
}

export class FlowMeta extends FlowLikeMeta<WritableFlowManifest> {
  public readonly $: FlowMeta$
  readonly #triggerDefinitions: ReadonlyVal<ReadonlyMap<string, TriggerDefinition>>

  public readonly KIND: Record<FlowLikeMetaKind, boolean> = {
    ...FlowLikeMeta.KIND,
  }

  /** `name` part of the flow path */
  public readonly flowName: FlowName

  public static is(flowMeta: any): flowMeta is FlowMeta {
    return isFlowLikeMeta(flowMeta) && flowMeta.flowLikeType === 'flow'
  }

  public static to(flowMeta: any): FlowMeta | undefined {
    if (FlowMeta.is(flowMeta)) {
      return flowMeta
    }
  }

  public constructor(
    public readonly flowPath: FlowPath,
    searchPath: SearchPath,
    packageMeta: PackageMeta,
    manifest: WritableFlowManifest,
    resolveSharedBlockMeta$: ResolveSharedBlockMeta$,
    resolveResourceUri: ResourceUriResolver,
  ) {
    super('flow', flowPath, searchPath, packageMeta, manifest, resolveSharedBlockMeta$, resolveResourceUri)

    this.flowName = this.manifestName as FlowName
    this.#triggerDefinitions = this.dispose.add(
      derive(
        manifest.$.trigger_definitions,
        (snapshots) => new Map((snapshots ?? []).map((snapshot) => [JSON.stringify([snapshot.type, snapshot.revision]), snapshot.definition])),
      ),
    )

    const inputHandleDefs = attachSetter(val<InputHandleDef[] | undefined>(), noop)
    const outputHandleDefs = attachSetter(val<OutputHandleDef[] | undefined>(), noop)
    const inputHandleNames = derive(inputHandleDefs, getHandleNames, {
      equal: arrayShallowEqual,
    })
    const handleOutputsFrom = attachSetter(val(), noop)

    const title = this.packageMeta.l10n.display$(manifest.$.title)
    const detail = this.packageMeta.l10n.detail$(manifest.$.title, manifest.$.description)
    const description = this.packageMeta.l10n.display$(manifest.$.description)
    const icon = derive(manifest.$.icon, (iconValue) => resolveResourceUri(iconValue, this.flowPath, this.searchPath))
    const outputHandleNames = derive(outputHandleDefs, getHandleNames, {
      equal: arrayShallowEqual,
    })
    const connectedInputHandles = val<HandleName[] | undefined>()

    this.$ = {
      title,
      detail,
      description,
      icon,
      inputHandleDefs,
      outputHandleDefs,
      inputHandleNames,
      outputHandleNames,
      handleOutputsFrom,
      connectedInputHandles,
    }

    this.dispose.add(Object.values(this.$))

    this.setupMigrateNodes()
  }

  public override triggerDefinition$(trigger$: ReadonlyVal<TriggerDescriptor | undefined>): ReadonlyVal<TriggerDefinition | undefined> {
    return combine([this.#triggerDefinitions, trigger$], ([definitions, trigger]) =>
      trigger == null ? undefined : definitions.get(JSON.stringify([trigger.type, trigger.revision])),
    )
  }

  public upsertTriggerNode(node: TriggerNode, snapshot: TriggerDefinitionSnapshot): void {
    const previous = this.manifest.nodeManifests.get(node.node_id)
    const previousTrigger = WritableTriggerNodeManifest.to(previous)?.$.trigger.value
    const operation = previous == null ? ({ type: 'add-node', node } as const) : ({ type: 'replace-node', node } as const)
    const removePrevious =
      previousTrigger != null &&
      (previousTrigger.type != snapshot.type || previousTrigger.revision != snapshot.revision) &&
      ![...this.manifest.nodeManifests.values()].some((candidate) => {
        const trigger = WritableTriggerNodeManifest.to(candidate)?.$.trigger.value
        return candidate.nodeId != node.node_id && trigger?.type == previousTrigger.type && trigger.revision == previousTrigger.revision
      })
    applyFlowEditOperations(this.manifest, [
      { type: 'add-trigger-definition', snapshot },
      operation,
      ...(removePrevious ? [{ type: 'remove-trigger-definition' as const, triggerType: previousTrigger.type, revision: previousTrigger.revision }] : []),
    ])
  }

  public override removeNodes(nodeMetaOrNodeMetas: NodeMeta[] | NodeMeta): boolean {
    const nodeMetas = inertFilter(
      Array.isArray(nodeMetaOrNodeMetas) ? nodeMetaOrNodeMetas : [nodeMetaOrNodeMetas],
      (nodeMeta) => nodeMeta.flowLikeMeta.manifest === this.manifest && this.manifest.nodeManifests.has(nodeMeta.nodeId),
    )
    if (nodeMetas.length == 0) return false

    const removedIds = new Set(nodeMetas.map((nodeMeta) => nodeMeta.nodeId))
    const removedDefinitions = new Map<string, TriggerDescriptor>()
    for (const nodeMeta of nodeMetas) {
      const trigger = WritableTriggerNodeManifest.to(nodeMeta.manifest)?.$.trigger.value
      if (trigger != null) removedDefinitions.set(JSON.stringify([trigger.type, trigger.revision]), trigger)
    }
    const operations: FlowEditOperation[] = nodeMetas.map((nodeMeta) => ({ type: 'remove-node', nodeId: nodeMeta.nodeId }))
    for (const trigger of removedDefinitions.values()) {
      const stillReferenced = [...this.manifest.nodeManifests.values()].some((node) => {
        const current = WritableTriggerNodeManifest.to(node)?.$.trigger.value
        return !removedIds.has(node.nodeId) && current?.type == trigger.type && current.revision == trigger.revision
      })
      if (!stillReferenced) {
        operations.push({ type: 'remove-trigger-definition', triggerType: trigger.type, revision: trigger.revision })
      }
    }
    applyFlowEditOperations(this.manifest, operations)
    this.packageMeta.cleanupRemovedNodes(nodeMetas)
    return true
  }
}
