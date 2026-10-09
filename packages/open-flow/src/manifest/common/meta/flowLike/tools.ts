import type { BlockResourceName } from '../../manifestTypes.ts'
import type { FlowLikeMeta } from './flowLikeMeta.ts'

import { WritableTaskNodeManifest } from '../../writable/node/writableTaskNodeManifest.ts'

export function renameNodeRefSharedBlockResource(
  flowLikeMetas: Iterable<FlowLikeMeta>,
  oldResourceName: BlockResourceName,
  newResourceName: BlockResourceName,
): void {
  for (const flowLikeMeta of flowLikeMetas) {
    for (const nodeMeta of flowLikeMeta.nodes.values()) {
      if (WritableTaskNodeManifest.is(nodeMeta.manifest)) {
        if (nodeMeta.manifest.$.task.value === oldResourceName) {
          nodeMeta.manifest.$$.task.set(newResourceName)
        }
      }
    }
  }
}
