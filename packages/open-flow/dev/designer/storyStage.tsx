import type { Node, NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import { useMemo, useRef } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { GetPopupContainerContext } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n } from '../../src/canvas/browser/i18n/i18n-loader.ts'
import { TooltipProvider } from '../../src/ui/browser/tooltip.tsx'

interface StoryNodeData extends Record<string, unknown> {
  readonly content: ReactNode
}
type StoryNode = Node<StoryNodeData, 'story'>
const nodeTypes = { story: StoryNodeView }

export function StoryStage({ children, dark, i18n }: { readonly children: ReactNode; readonly dark: boolean; readonly i18n: ReturnType<typeof createI18n> }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLDivElement>(null)
  const getFlowPopupContainer = () => stageRef.current?.querySelector<HTMLElement>('.react-flow__viewport') || stageRef.current || document.body
  const getStaticPopupContainer = () => staticRef.current || document.body
  const context = useMemo(() => ({ default: getFlowPopupContainer, static: getStaticPopupContainer }), [])
  const nodes = useMemo<StoryNode[]>(
    () => [{ id: 'story', type: 'story', position: { x: 80, y: 60 }, data: { content: children }, draggable: false, selectable: true }],
    [children],
  )

  return (
    <div className="stage-frame" ref={stageRef}>
      <div className={`open-flow-canvas-root open-flow-theme stage-theme`} data-surface="canvas" data-theme={dark ? 'dark' : 'light'}>
        <div className="stage-static-root" ref={staticRef} />
        <GetPopupContainerContext.Provider value={context}>
          <I18nProvider i18n={i18n}>
            <TooltipProvider delay={250}>
              <ReactFlow
                colorMode={dark ? 'dark' : 'light'}
                edges={[]}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.12 }}
                maxZoom={3}
                minZoom={0.1}
                nodeTypes={nodeTypes}
                nodes={nodes}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </TooltipProvider>
          </I18nProvider>
        </GetPopupContainerContext.Provider>
      </div>
    </div>
  )
}

function StoryNodeView({ data }: NodeProps<StoryNode>) {
  return (
    <div className="story-node-outer">
      <main className="story-node-container">
        <div className="story-node-body nopan">{data.content}</div>
      </main>
    </div>
  )
}
