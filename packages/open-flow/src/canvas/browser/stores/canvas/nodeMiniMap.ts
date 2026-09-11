export const NODE_MINIMAP_PHASE1_CLASSNAME = 'open-flow-canvas-node-minimap1'
export const NODE_MINIMAP_PHASE2_CLASSNAME = 'open-flow-canvas-node-minimap2'

export enum NodeMiniMapPhase {
  None,
  Phase1,
  Phase2,
}

const NODE_MINIMAP_PHASE1_ZOOM = 0.45
const NODE_MINIMAP_PHASE2_ZOOM = 0.2

export const NO_NODE_MINIMAP_MAX_ITEMS = 0

export function getNodeMinimap(nodesSize: number, zoom: number): NodeMiniMapPhase {
  if (nodesSize <= NO_NODE_MINIMAP_MAX_ITEMS) {
    return NodeMiniMapPhase.None
  }
  if (zoom < NODE_MINIMAP_PHASE2_ZOOM) {
    return NodeMiniMapPhase.Phase2
  }
  if (zoom < NODE_MINIMAP_PHASE1_ZOOM) {
    return NodeMiniMapPhase.Phase1
  }
  return NodeMiniMapPhase.None
}
