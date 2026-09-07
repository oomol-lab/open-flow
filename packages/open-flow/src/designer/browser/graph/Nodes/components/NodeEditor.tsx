import styles from './NodeEditor.module.scss'
import type { NodeId } from '../../../../../schema/index.ts'

import { useContext, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { HandleContext } from '../../../components/handle.tsx'
import { TranslationInput } from '../../../components/input2.tsx'
import { NodeMiniMapPhase, NodeMiniMapProvider } from '../../../components/minimap.tsx'
import { designerThemeClass } from '../../../theme/designerThemeClass.ts'
import { useThemeData } from '../../../theme/ThemeProvider.tsx'
import { ThemeProvider } from '../../../theme/ThemeProvider.tsx'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { CanvasContext } from '../../FlowDesigner/CanvasContext.ts'
import { GetPopupContainerContext } from '../../ReactFlowContainer/useGetPopupContainer.ts'
import { NodeStoreContext, useNodeStore } from '../NodeStoreContext.tsx'
import { NodeBody } from './NodeBody.tsx'
import { NodeHead } from './NodeHead.tsx'

export function NodeEditorPortal() {
  const view = useContext(CanvasContext)
  const store = useDesignerStore()
  const nodes = useVal(store.$.nodes.$)
  const comments = useVal(store.$.commentNodes?.$)
  const id = view?.selectedNodeIds.length == 1 ? (view.selectedNodeIds[0] as NodeId) : undefined
  const node = id == null ? undefined : (nodes.get(id) ?? comments?.get(id))
  if (node == null || view?.inspectorContainer == null) return null
  return createPortal(
    <NodeMiniMapProvider value={NodeMiniMapPhase.None}>
      <NodeStoreContext.Provider value={node}>
        <NodeEditor key={node.nodeId} />
      </NodeStoreContext.Provider>
    </NodeMiniMapProvider>,
    view.inspectorContainer,
  )
}

export function NodeEditor() {
  const t = useTranslate()
  const root = useRef<HTMLDivElement>(null)
  const theme = useThemeData()
  const store = useDesignerStore()
  const node = useNodeStore()
  const editable = useVal(store.$.editable)
  const popup = useMemo(() => ({ default: () => root.current ?? document.body, static: () => root.current ?? document.body }), [])
  return (
    <div
      ref={root}
      className={`oo-designer-root nokey ${designerThemeClass(theme.isDark)} ${styles.editor}`}
      data-theme={theme.isDark ? 'dark' : 'light'}
      data-node-editor
      onPointerDown={(event) => event.stopPropagation()}
    >
      <GetPopupContainerContext.Provider value={popup}>
        <ThemeProvider dark={theme.isDark} getPopupContainer={popup.default}>
          <HandleContext.Provider value={{ Handle: null }}>
            <NodeHead />
            {node.display$ && (
              <div className={styles.description}>
                <span>{t('canvasCard.description')}</span>
                <TranslationInput
                  multiline
                  rawValue$={editable ? node.manifest$?.description : undefined}
                  displayValue$={node.display$.description}
                  placeholder={t('canvasCard.describe')}
                />
              </div>
            )}
            <NodeBody />
          </HandleContext.Provider>
        </ThemeProvider>
      </GetPopupContainerContext.Provider>
    </div>
  )
}
