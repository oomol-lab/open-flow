import type { Node, NodeChange, NodePositionChange, XYPosition } from '@xyflow/react'

import { useCallback, useState } from 'react'

export type HelperLinesData = [
  horizontal: number | undefined,
  vertical: number | undefined,
  onBeforeApplyNodesChanges: (changes: NodeChange[], nodes: Node[]) => void,
]

export const useHelperLines = (): HelperLinesData => {
  const [horizontal, setHorizontal] = useState<number | undefined>()
  const [vertical, setVertical] = useState<number | undefined>()

  const onBeforeApplyNodesChanges = useCallback((changes: NodeChange[], nodes: Node[]) => {
    // Clear any existing helper lines.
    setHorizontal(undefined)
    setVertical(undefined)

    // Calculate helper lines and a snap position while dragging a single node.
    if (changes.length === 1 && changes[0].type === 'position' && changes[0].dragging && changes[0].position) {
      const helperLines = getHelperLines(changes[0], nodes)

      // Snap the node by updating the position change in place.
      changes[0].position.x = helperLines.snapPosition.x ?? changes[0].position.x
      changes[0].position.y = helperLines.snapPosition.y ?? changes[0].position.y

      // Store returned helper lines for rendering.
      setHorizontal(helperLines.horizontal)
      setVertical(helperLines.vertical)
    }
  }, [])

  return [horizontal, vertical, onBeforeApplyNodesChanges] as const
}

interface GetHelperLinesResult {
  horizontal?: number
  vertical?: number
  snapPosition: Partial<XYPosition>
}

// Calculate helper lines and the snap position for a node position change.
function getHelperLines(change: NodePositionChange, nodes: Node[], distance = 8): GetHelperLinesResult {
  const defaultResult = {
    horizontal: undefined,
    vertical: undefined,
    snapPosition: { x: undefined, y: undefined },
  }
  const nodeA = nodes.find((node) => node.id === change.id)

  if (!nodeA || !change.position) {
    return defaultResult
  }

  const nodeABounds = {
    left: change.position.x,
    right: change.position.x + (nodeA.measured?.width ?? 0),
    top: change.position.y,
    bottom: change.position.y + (nodeA.measured?.height ?? 0),
    width: nodeA.measured?.width ?? 0,
    height: nodeA.measured?.height ?? 0,
  }

  let horizontalDistance = distance
  let verticalDistance = distance

  return nodes.reduce<GetHelperLinesResult>((result, nodeB) => {
    if (nodeB.id === nodeA.id) {
      return result
    }

    const nodeBBounds = {
      left: nodeB.position.x,
      right: nodeB.position.x + (nodeB.measured?.width ?? 0),
      top: nodeB.position.y,
      bottom: nodeB.position.y + (nodeB.measured?.height ?? 0),
      width: nodeB.measured?.width ?? 0,
      height: nodeB.measured?.height ?? 0,
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |
    //  |___________|
    //  |
    //  |
    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     B     |
    //  |___________|
    const distanceLeftLeft = Math.abs(nodeABounds.left - nodeBBounds.left)

    if (distanceLeftLeft < verticalDistance) {
      result.snapPosition.x = nodeBBounds.left
      result.vertical = nodeBBounds.left
      verticalDistance = distanceLeftLeft
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |
    //  |___________|
    //              |
    //              |
    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     B     |
    //  |___________|
    const distanceRightRight = Math.abs(nodeABounds.right - nodeBBounds.right)

    if (distanceRightRight < verticalDistance) {
      result.snapPosition.x = nodeBBounds.right - nodeABounds.width
      result.vertical = nodeBBounds.right
      verticalDistance = distanceRightRight
    }

    //              |‾‾‾‾‾‾‾‾‾‾‾|
    //              |     A     |
    //              |___________|
    //              |
    //              |
    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     B     |
    //  |___________|
    const distanceLeftRight = Math.abs(nodeABounds.left - nodeBBounds.right)

    if (distanceLeftRight < verticalDistance) {
      result.snapPosition.x = nodeBBounds.right
      result.vertical = nodeBBounds.right
      verticalDistance = distanceLeftRight
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |
    //  |___________|
    //              |
    //              |
    //              |‾‾‾‾‾‾‾‾‾‾‾|
    //              |     B     |
    //              |___________|
    const distanceRightLeft = Math.abs(nodeABounds.right - nodeBBounds.left)

    if (distanceRightLeft < verticalDistance) {
      result.snapPosition.x = nodeBBounds.left - nodeABounds.width
      result.vertical = nodeBBounds.left
      verticalDistance = distanceRightLeft
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|‾‾‾‾‾|‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |     |     B     |
    //  |___________|     |___________|
    const distanceTopTop = Math.abs(nodeABounds.top - nodeBBounds.top)

    if (distanceTopTop < horizontalDistance) {
      result.snapPosition.y = nodeBBounds.top
      result.horizontal = nodeBBounds.top
      horizontalDistance = distanceTopTop
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |
    //  |___________|_________________
    //                    |           |
    //                    |     B     |
    //                    |___________|
    const distanceBottomTop = Math.abs(nodeABounds.bottom - nodeBBounds.top)

    if (distanceBottomTop < horizontalDistance) {
      result.snapPosition.y = nodeBBounds.top - nodeABounds.height
      result.horizontal = nodeBBounds.top
      horizontalDistance = distanceBottomTop
    }

    //  |‾‾‾‾‾‾‾‾‾‾‾|     |‾‾‾‾‾‾‾‾‾‾‾|
    //  |     A     |     |     B     |
    //  |___________|_____|___________|
    const distanceBottomBottom = Math.abs(nodeABounds.bottom - nodeBBounds.bottom)

    if (distanceBottomBottom < horizontalDistance) {
      result.snapPosition.y = nodeBBounds.bottom - nodeABounds.height
      result.horizontal = nodeBBounds.bottom
      horizontalDistance = distanceBottomBottom
    }

    //                    |‾‾‾‾‾‾‾‾‾‾‾|
    //                    |     B     |
    //                    |           |
    //  |‾‾‾‾‾‾‾‾‾‾‾|‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
    //  |     A     |
    //  |___________|
    const distanceTopBottom = Math.abs(nodeABounds.top - nodeBBounds.bottom)

    if (distanceTopBottom < horizontalDistance) {
      result.snapPosition.y = nodeBBounds.bottom
      result.horizontal = nodeBBounds.bottom
      horizontalDistance = distanceTopBottom
    }

    return result
  }, defaultResult)
}
