import type { ReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { NodeType } from '../../model/node/nodeManifest.ts'
import type { OnYamlParentUpdated } from '../../writableFileManifest.ts'
import type { YamlParent, YamlMap } from '../../yaml.ts'
import type { WritableNodeManifest } from './writableNodeManifest.ts'

import { isNodeId } from '../../utils.ts'
import { bindWritableSeqMap } from '../../writableFileManifest.ts'
import { isYamlMap, getYamlNodeValue } from '../../yaml.ts'
import { WritableConditionNodeManifest } from './writableConditionNodeManifest.ts'
import { WritableTaskNodeManifest } from './writableTaskNodeManifest.ts'
import { WritableTriggerNodeManifest } from './writableTriggerNodeManifest.ts'
import { WritableValueNodeManifest } from './writableValueNodeManifest.ts'

export function bindWritableNodes(yamlParent: YamlParent, field = 'nodes'): [ReactiveMap<NodeId, WritableNodeManifest>, OnYamlParentUpdated] {
  return bindWritableSeqMap(
    yamlParent,
    field,
    (nodeYaml, nodes) => {
      if (isYamlMap(nodeYaml)) {
        const nodeId = getYamlNodeValue(nodeYaml, 'node_id').unwrapOr()
        if (isNodeId(nodeId)) {
          const oldNodeManifest = nodes.get(nodeId)
          const nodeType = parseNodeType(nodeYaml)
          if (oldNodeManifest && oldNodeManifest.nodeType === nodeType) {
            oldNodeManifest.onYamlParentUpdated(nodeYaml)
            return [nodeId, oldNodeManifest]
          } else {
            const nodeManifest = parseWritableNode(nodeYaml, nodeId, nodeType)
            return [nodeId, nodeManifest]
          }
        }
      }
    },
    (nodeManifest) => nodeManifest.yamlParent,
  )
}

function parseNodeType(nodeYaml: YamlMap): NodeType {
  if (getYamlNodeValue(nodeYaml, 'trigger').isSome()) {
    return 'trigger'
  }

  if (getYamlNodeValue(nodeYaml, 'values').isSome()) {
    return 'value'
  }

  if (getYamlNodeValue(nodeYaml, 'conditions').isSome()) {
    return 'condition'
  }

  return 'task'
}

function parseWritableNode(nodeYaml: YamlMap, nodeId: NodeId, nodeType: NodeType): WritableNodeManifest {
  switch (nodeType) {
    case 'value':
      return new WritableValueNodeManifest(nodeId, nodeYaml)
    case 'condition':
      return new WritableConditionNodeManifest(nodeId, nodeYaml)
    case 'trigger':
      return new WritableTriggerNodeManifest(nodeId, nodeYaml)
    case 'task':
      return new WritableTaskNodeManifest(nodeId, nodeYaml)
  }
}
