import styles from './NodeEditor.module.scss'
import type { NodeId } from '../../../../../schema/index.ts'
import type { FlowDesignerViewProps } from '../../FlowDesigner/model.ts'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVal } from 'use-value-enhancer'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { GetPopupContainerContext } from '../../ReactFlowContainer/useGetPopupContainer.ts'
import { NodeStoreContext, useNodeStore } from '../NodeStoreContext.tsx'
import { CommentNodeContent } from './CommentNodeContent.tsx'
import { NodeHead } from './NodeHead.tsx'

export function NodeEditorPortal({
  view,
  dark,
}: {
  dark: boolean
  view?: Pick<FlowDesignerViewProps, 'selectedNodeIds' | 'inspectorContainer' | 'inspectorHeaderContainer'>
}) {
  const store = useDesignerStore()
  const nodes = useVal(store.$.nodes.$)
  const comments = useVal(store.$.commentNodes?.$)
  const id = view?.selectedNodeIds.length == 1 ? (view.selectedNodeIds[0] as NodeId) : undefined
  const node = id == null ? undefined : (nodes.get(id) ?? comments?.get(id))
  if (node == null || view?.inspectorContainer == null) return null
  return createPortal(
    <NodeStoreContext.Provider value={node}>
      <NodeEditor dark={dark} key={node.nodeId} inspectorHeaderContainer={view.inspectorHeaderContainer} />
    </NodeStoreContext.Provider>,
    view.inspectorContainer,
  )
}

function NodeEditor({ inspectorHeaderContainer, dark }: Pick<FlowDesignerViewProps, 'inspectorHeaderContainer'> & { dark: boolean }) {
  const node = useNodeStore()
  const root = useRef<HTMLDivElement>(null)
  const [heading, setHeading] = useState<HTMLDivElement | null>(null)
  const popup = useMemo(() => ({ default: () => root.current ?? document.body, static: () => root.current ?? document.body }), [])
  return (
    <div
      ref={root}
      className={`oo-designer-root nokey open-flow-theme ${styles.editor}`}
      data-surface="canvas"
      data-theme={dark ? 'dark' : 'light'}
      data-node-editor
      onPointerDown={(event) => event.stopPropagation()}
    >
      <GetPopupContainerContext.Provider value={popup}>
        {inspectorHeaderContainer != null &&
          createPortal(
            <div
              ref={setHeading}
              className={`oo-designer-root nokey open-flow-theme ${styles.heading}`}
              data-surface="canvas"
              data-theme={dark ? 'dark' : 'light'}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {heading != null && (
                <GetPopupContainerContext.Provider value={{ default: () => heading, static: () => heading }}>
                  <NodeHead actionsOnly={!CommentNodeStore.is(node)} />
                </GetPopupContainerContext.Provider>
              )}
            </div>,
            inspectorHeaderContainer,
          )}
        {CommentNodeStore.is(node) && <CommentNodeContent store={node} />}
      </GetPopupContainerContext.Provider>
    </div>
  )
}
