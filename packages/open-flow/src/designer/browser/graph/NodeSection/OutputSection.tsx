import styles from './NodeSection.module.scss'
import type { HandleName } from '../../../../schema/index.ts'
import type { OutputSectionStore } from '../../stores/node/nodeSection/outputSection.store.ts'
import type { ICardAction } from './card.tsx'

import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import { memo, useCallback, useEffect, useId, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { stopPropagation } from '../../base/dom.ts'
import { toRFHandleName } from '../../base/rfHelpers.ts'
import { arrayFindIndexOrLength, isBannedName, toTrue } from '../../base/trivial.ts'
import { Handle } from '../../components/handle.tsx'
import { HandleIcon } from '../../components/handleIcon.tsx'
import { HandleEditor } from '../../jsonSchema/handleEditor.tsx'
import { SUBFLOW_VIEW_MODE } from '../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../stores/designer/typings.ts'
import { OUTPUT_SECTION_TYPE } from '../../stores/node/nodeSection/constants.ts'
import { HandleRowStore } from '../../stores/nodeHandle/handleRow.store.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { useNodeStore } from '../Nodes/NodeStoreContext.tsx'
import { useSubflowViewMode } from '../SubflowDesigner/SubflowViewModeContext.ts'
import { Card, NodeSectionActionButton } from './card.tsx'
import { useDragAndDrop } from './dragNDrop.ts'
import { GroupedHandles } from './GroupedHandles.tsx'

export interface OutputSectionProps {
  section: OutputSectionStore
}

export const OutputSection: React.FC<OutputSectionProps> = /* @__PURE__ */ memo(({ section }) => {
  const t = useTranslate()
  const additionalLabelId = useId()
  const nodeStore = useNodeStore()
  const designerStore = useDesignerStore()
  const subflowViewMode = useSubflowViewMode()
  const isInBlock = designerStore.designerType === DESIGNER_TYPE.Block || subflowViewMode === SUBFLOW_VIEW_MODE.Block
  const branches = useVal(nodeStore.display$?.branches)
  const editable = useVal(designerStore.$.editable)
  const handles = useVal(section.$.handles)
  const allHandleNames = useVal(section.$.allHandleNames)
  const additionalOutputs = useVal(section.$.additionalOutputs)
  const canEditSchema = section.role === 'author' || (section.role === 'user' && additionalOutputs && !!section.$$.additionalOutputDefs)
  const [additional, setAdditional] = useState(true)
  const update = useUpdateNodeInternals()
  const reactFlowStore = useStoreApi()
  const dnd = useDragAndDrop(handles, section)

  // Render a default-additional marker before the first additional handle in the block designer.
  const hasDefaultAdditional = section.role === 'author' && additionalOutputs && !!section.$$.additionalOutputDefs
  const additionalAt = hasDefaultAdditional ? arrayFindIndexOrLength(handles, (h) => HandleRowStore.is(h) && h.context.additional) : -1

  const validateName = useCallback(
    (name: string, oldName: string): string | undefined => {
      if (!name) return t('handleEditor.renaming.empty')
      if (name === oldName) return
      if (isBannedName(name)) {
        return t('handleEditor.renaming.banned', { name })
      }
      if (allHandleNames.includes(name as HandleName)) {
        return t('handleEditor.renaming.duplicate')
      }
    },
    [allHandleNames, t],
  )

  // See https://reactflow.dev/api-reference/components/handle#dynamic-handles.
  useEffect(() => section.onDidHandleIndexChange(() => update(nodeStore.rfNodeId)), [nodeStore])

  useEffect(() => {
    if (additionalAt === handles.length) {
      setAdditional(false)
    }
  }, [additionalAt, handles.length])

  const actionAdd: ICardAction | undefined = toTrue(canEditSchema) && {
    icon: 'i-codicon:add',
    title: t('outputHandleEditor.addOutput'),
    onClick: () => section.addNewHandle(),
  }

  if (!canEditSchema && handles.length === 0) {
    // A writable definition renders an empty card so the user can add a handle.
    // A read-only empty definition does not need a card.
    return null
  }

  const renderHandle = (handle: HandleRowStore) => {
    const editor = (
      <HandleEditor
        key={handle.name}
        store={handle}
        panelWidth$={designerStore.$$.settingsPanelWidth}
        reactFlowStore={reactFlowStore}
        validate={validateName}
        dragTarget={dnd.dragTarget}
        dragPosition={dnd.dragPosition}
        onRename={(newName) => section.renameHandle(handle.name, newName as HandleName)}
        onDelete={() => section.deleteHandle(handle.name)}
        onDragStart={(ev) => dnd.onDragStart(ev, handle)}
        onDragOver={(ev) => dnd.onDragOver(ev, handle)}
      />
    )
    return branches?.includes(handle.name) ? (
      <div key={handle.name} className={styles.branchRow}>
        <Handle className={styles.branchHandle} id={toRFHandleName(`$branch:${handle.name}` as HandleName)} type="output" isConnectable={editable} />
        {editor}
      </div>
    ) : (
      editor
    )
  }

  const renderAdditionalHeader = () => {
    const action: ICardAction = {
      icon: 'i-codicon:add',
      title: t('blockEditor.addDefaultAdditionalOutput'),
      onClick: () => {
        setAdditional(true)
        section.addNewHandle(true)
      },
    }

    const toggle = (ev: React.MouseEvent) => {
      stopPropagation(ev)
      setAdditional(!additional)
    }

    return (
      <div className={`${NODE_HANDLE_CLASSNAME} ${styles.additionalHeader}`}>
        <button
          aria-expanded={additional}
          aria-labelledby={additionalLabelId}
          className={`${styles.arrow} nodrag`}
          disabled={additionalAt === handles.length}
          onClick={toggle}
          type="button"
        >
          {additional ? <i className="i-carbon:chevron-down" /> : <i className="i-carbon:chevron-right" />}
        </button>
        <span id={additionalLabelId}>{t('blockEditor.defaultAdditionalOutputs')}</span>
        <NodeSectionActionButton action={action} />
      </div>
    )
  }

  return (
    <Card
      name={OUTPUT_SECTION_TYPE}
      className={branches != null ? styles.branchSection : undefined}
      icon="i-carbon:port-output"
      title={t('outputHandleEditor.title')}
      contentClassName={styles.inoutSectionCard}
      actions={actionAdd}
      onDrop={dnd.onDrop}
      onDragEnd={dnd.onDragEnd}
    >
      {handles.length > 0 ? (
        <>
          <div className={styles.outputHeader}>
            <span>{t('outputHandleEditor.handleKeyTitle')}</span>
            <span>{t('outputHandleEditor.handleTypeTitle')}</span>
            <span>
              <span className={styles.nullable}>{t('outputHandleEditor.nullable')}</span>
            </span>
          </div>
          {additionalAt >= 0 ? (
            <>
              <GroupedHandles section={section} handles={handles.slice(0, additionalAt)} renderHandle={renderHandle} dnd={dnd} />
              {renderAdditionalHeader()}
              {additional && handles.slice(additionalAt).filter(HandleRowStore.is).map(renderHandle)}
            </>
          ) : (
            <GroupedHandles section={section} handles={handles} renderHandle={renderHandle} dnd={dnd} />
          )}
        </>
      ) : (
        additionalAt >= 0 && renderAdditionalHeader()
      )}
      {canEditSchema &&
        handles.length === 0 &&
        additionalAt < 0 &&
        (isInBlock ? (
          <button data-drop-or-click="true" className={styles.dropTip} onClick={actionAdd?.onClick} type="button">
            <i className="i-codicon:add" />
            <span className={styles.click}>{t('handleEditor.click')}</span>
          </button>
        ) : (
          <button data-drop-or-click="true" className={styles.dropTip} onClick={actionAdd?.onClick} type="button">
            <HandleIcon />
            <span className={styles.dropOr}>{t('handleEditor.dropOr')}</span>
            <i className="i-codicon:add" />
            <span className={styles.click}>{t('handleEditor.click')}</span>
          </button>
        ))}
    </Card>
  )
})
