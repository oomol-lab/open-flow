import type { RFNode } from '../../base/rfHelpers.ts'

import { disposableStore } from '@wopjs/disposable'
import { attachSetter, derive, val } from 'value-enhancer'
import { isSameSize, isSameXYPosition } from '../../base/compare.ts'
import { updatePartial } from '../../base/trivial.ts'

/** React Flow interaction state. Product content and persistence belong to the canvas model and host. */
export function createNodeInteraction(initial: RFNode, width?: number) {
  const dispose = disposableStore()
  const rfNode = dispose.add(val(initial))
  return {
    dispose,
    rfNode,
    position: dispose.add(
      attachSetter(
        derive(rfNode, (node) => node.position, { equal: isSameXYPosition }),
        updatePartial(rfNode, 'position', isSameXYPosition),
      ),
    ),
    selected: dispose.add(
      attachSetter(
        derive(rfNode, (node) => node.selected),
        updatePartial(rfNode, 'selected'),
      ),
    ),
    measured: dispose.add(derive(rfNode, (node) => node.measured, { equal: isSameSize })),
    contentWidth: dispose.add(val<number | undefined>(width)),
  }
}

export type NodeInteraction = ReturnType<typeof createNodeInteraction>
