import styles from './NodeSection.module.scss'
import type { HandleName } from '../../../../schema/index.ts'
import type { InputSectionStore } from '../../stores/node/nodeSection/inputSection.store.ts'
import type { ICardAction } from './card.tsx'

import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import { memo, useCallback, useEffect, useId, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { stopPropagation } from '../../base/dom.ts'
import { arrayFindIndexOrLength, isBannedName, toTrue } from '../../base/trivial.ts'
import { CssWrapper } from '../../components/cssWrapper.tsx'
import { HandleIcon } from '../../components/handleIcon.tsx'
import { HandleEditor } from '../../jsonSchema/handleEditor.tsx'
import { SUBFLOW_VIEW_MODE } from '../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../stores/designer/typings.ts'
import { NODE_TYPE } from '../../stores/node/constants.ts'
import { INPUT_SECTION_TYPE } from '../../stores/node/nodeSection/constants.ts'
import { HandleRowStore } from '../../stores/nodeHandle/handleRow.store.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { useNodeStore } from '../Nodes/NodeStoreContext.tsx'
import { useSubflowViewMode } from '../SubflowDesigner/SubflowViewModeContext.ts'
import { Card, NodeSectionActionButton } from './card.tsx'
import { INPUT_FACTORS } from './constants.ts'
import { useDragAndDrop } from './dragNDrop.ts'
import { GroupedHandles } from './GroupedHandles.tsx'
import { InputHandleSection } from './InputHandleSection.tsx'

export interface InputSectionProps {
  section: InputSectionStore
  readonly showSchemaSettings?: boolean
}

export const InputSection: React.FC<InputSectionProps> = /* @__PURE__ */ memo(({ section, showSchemaSettings }) => {
  const t = useTranslate()
  const additionalLabelId = useId()
  const nodeStore = useNodeStore()
  const designerStore = useDesignerStore()
  const subflowViewMode = useSubflowViewMode()
  const isInBlock = designerStore.designerType === DESIGNER_TYPE.Block || subflowViewMode === SUBFLOW_VIEW_MODE.Block
  const handles = useVal(section.$.handles)
  const productHandles = useVal(section.$.productHandles)
  const variableInputs = useVal(designerStore.$.variableInputs)
  const variableNames = useVal(designerStore.$.variableNames)
  const variableNamesLoaded = useVal(designerStore.$.variableNamesLoaded)
  const variableNamesLoading = useVal(designerStore.$.variableNamesLoading)
  const allHandleNames = useVal(section.$.allHandleNames)
  const additionalInputs = useVal(section.$.additionalInputs)
  const canEditSchema = section.role === 'author' || (section.role === 'user' && additionalInputs && !!section.$$.additionalInputDefs)
  const [additional, setAdditional] = useState(true)
  const update = useUpdateNodeInternals()
  const reactFlowStore = useStoreApi()
  const dnd = useDragAndDrop(handles, section)
  const productDnd = useDragAndDrop(productHandles, section)

  // Render a default-additional marker before the first additional handle in the block designer.
  const hasDefaultAdditional = section.role === 'author' && additionalInputs && !!section.$$.additionalInputDefs
  const additionalAt = hasDefaultAdditional ? arrayFindIndexOrLength(handles, (h) => HandleRowStore.is(h) && h.context.additional) : -1
  // Condition nodes insert a synthetic group after the first handle to show that only it becomes output.
  const isConditionNode = nodeStore.nodeType === NODE_TYPE.ConditionNode

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
    title: t('inputHandleEditor.addInput'),
    onClick: () => section.addNewHandle(),
  }

  if (!canEditSchema && handles.length === 0 && productHandles.length === 0) {
    // A writable definition renders an empty card so the user can add a handle.
    // A read-only empty definition does not need a card.
    return null
  }

  const renderHandle = (handle: HandleRowStore) => {
    const variable = variableInputs.get(`${nodeStore.nodeId}\0${handle.name}`)
    return (
      <HandleEditor
        key={handle.name}
        store={handle}
        panelWidth$={designerStore.$$.settingsPanelWidth}
        reactFlowStore={reactFlowStore}
        showSchemaSettings={showSchemaSettings}
        validate={validateName}
        onRename={(newName) => section.renameHandle(handle.name, newName as HandleName)}
        onDelete={() => section.deleteHandle(handle.name)}
        dragTarget={dnd.dragTarget}
        dragPosition={dnd.dragPosition}
        onDragStart={(ev) => dnd.onDragStart(ev, handle)}
        onDragOver={(ev) => dnd.onDragOver(ev, handle)}
        variable={
          variable == null
            ? undefined
            : {
                loaded: variableNamesLoaded,
                loading: variableNamesLoading,
                names: variableNames,
                name: variable.name,
                onChange: (name) => designerStore.onChangeInputVariable?.(nodeStore.nodeId, handle.name, name),
                onOpen: () => designerStore.onOpenVariables?.(),
              }
        }
      />
    )
  }

  const renderAdditionalHeader = () => {
    const action: ICardAction = {
      icon: 'i-codicon:add',
      title: t('blockEditor.addDefaultAdditionalInput'),
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
        <span id={additionalLabelId}>{t('blockEditor.defaultAdditionalInputs')}</span>
        <NodeSectionActionButton action={action} />
      </div>
    )
  }

  return (
    <>
      {(canEditSchema || handles.length > 0) && (
        <Card
          name={INPUT_SECTION_TYPE}
          icon="i-carbon:port-input"
          title={t('inputHandleEditor.title')}
          help={toTrue(isConditionNode && handles.length > 1) && t('condition.inputHelp')}
          contentClassName={styles.inoutSectionCard}
          actions={actionAdd}
          onDrop={dnd.onDrop}
          onDragEnd={dnd.onDragEnd}
        >
          {handles.length > 0 ? (
            <CssWrapper css={INPUT_FACTORS}>
              <div className={`${NODE_HANDLE_CLASSNAME} ${styles.inputHeader}`}>
                <span>{t('inputHandleEditor.handleKeyTitle')}</span>
                <span>
                  <span className={styles.type}>{t('inputHandleEditor.handleTypeTitle')}</span>
                  <span className={styles.value}>{t('inputHandleEditor.handleValueTitle')}</span>
                </span>
                <span>
                  <span className={styles.nullable}>{t('inputHandleEditor.nullable')}</span>
                </span>
              </div>
              {additionalAt >= 0 ? (
                <>
                  <GroupedHandles section={section} handles={handles.slice(0, additionalAt)} renderHandle={renderHandle} dnd={dnd} />
                  {renderAdditionalHeader()}
                  {additional && handles.slice(additionalAt).filter(HandleRowStore.is).map(renderHandle)}
                </>
              ) : (
                <GroupedHandles isConditionNode={isConditionNode} section={section} handles={handles} renderHandle={renderHandle} dnd={dnd} />
              )}
            </CssWrapper>
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
      )}
      {productHandles.map((handle) => (
        <InputHandleSection
          key={handle.name}
          handle={handle}
          handleNames={allHandleNames}
          dnd={productDnd}
          panelWidth$={designerStore.$$.settingsPanelWidth}
          reactFlowStore={reactFlowStore}
          showSchemaSettings={showSchemaSettings}
          validate={validateName}
          onRename={(newName) => section.renameHandle(handle.name, newName)}
          onDelete={() => section.deleteHandle(handle.name)}
        />
      ))}
    </>
  )
})
