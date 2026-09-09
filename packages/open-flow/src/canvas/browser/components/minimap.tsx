import { createContext, useContext } from 'react'
import { NodeMiniMapPhase } from '../stores/canvas/nodeMiniMap.ts'

export { NodeMiniMapPhase }

const NodeMiniMapContext = /*#__PURE__*/ createContext<NodeMiniMapPhase>(NodeMiniMapPhase.None)

export const NodeMiniMapProvider: React.Provider<NodeMiniMapPhase> = /*#__PURE__*/ (() => NodeMiniMapContext.Provider)()

export function useNodeMiniMapPhase(): NodeMiniMapPhase {
  return useContext(NodeMiniMapContext)
}
