import styles from './NodeSection.module.scss'
import type { HandleName } from '../../../../schema/index.ts'
import type { ConditionRowStore } from '../../stores/conditionHandle/conditionRow.store.ts'
import type { ConditionsSectionStore } from '../../stores/node/nodeSection/conditionsSection.store.ts'
import type { ICardAction } from './card.tsx'

import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import { memo, useCallback, useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { toRFHandleName } from '../../base/rfHelpers.ts'
import { coalesce, isBannedName, last, toTrue } from '../../base/trivial.ts'
import { CssWrapper } from '../../components/cssWrapper.tsx'
import { Handle } from '../../components/handle.tsx'
import { HandleIcon } from '../../components/handleIcon.tsx'
import { ConditionEditor } from '../../jsonSchema/conditionEditor.tsx'
import { CONDITIONS_SECTION_TYPE } from '../../stores/node/nodeSection/constants.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { useNodeStore } from '../Nodes/NodeStoreContext.tsx'
import { Card } from './card.tsx'
import { CONDITION_FACTORS } from './constants.ts'
import { useDragAndDrop } from './dragNDrop.ts'

export interface ConditionsSectionProps {
  section: ConditionsSectionStore
}

export const ConditionsSection: React.FC<ConditionsSectionProps> = /*#__PURE__*/ memo(({ section }) => {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const designerStore = useDesignerStore()
  const editable = useVal(designerStore.$.editable)
  const handles = useVal(section.$.handles)
  const allHandleNames = useVal(section.$.allHandleNames)
  const canEditSchema = section.role === 'author'
  const update = useUpdateNodeInternals()
  const reactFlowStore = useStoreApi()
  const dnd = useDragAndDrop(handles, section)

  useEffect(() => section.onDidHandleIndexChange(() => update(nodeStore.rfNodeId)), [nodeStore])

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

  const hasDefault = last(handles)?.context.isDefault
  const actionToggleDefault: ICardAction | undefined = toTrue(canEditSchema) && {
    icon: 'i-carbon:mac-option',
    title: t('condition.toggleDefault'),
    active: hasDefault,
    onClick: () => section.toggleDefaultHandle(),
  }

  const actionAdd: ICardAction | undefined = toTrue(canEditSchema) && {
    icon: 'i-codicon:add',
    title: t('condition.addCondition'),
    onClick: () => section.addNewHandle(),
  }

  const renderHandle = (handle: ConditionRowStore) => (
    <div key={handle.name} className={styles.branchRow}>
      <Handle className={styles.branchHandle} id={toRFHandleName(`$branch:${handle.name}` as HandleName)} type="output" isConnectable={editable} />
      <ConditionEditor
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
        addCondition={() => section.addNewHandle(handle.name)}
      />
    </div>
  )

  return (
    <Card
      name={CONDITIONS_SECTION_TYPE}
      icon="i-carbon:branch"
      title={t('condition.title')}
      contentClassName={styles.inoutSectionCard}
      actions={coalesce([actionToggleDefault, actionAdd])}
      onDrop={dnd.onDrop}
      onDragEnd={dnd.onDragEnd}
    >
      {handles.length > 0 && (
        <CssWrapper css={CONDITION_FACTORS}>
          <div className={styles.outputHeader}>
            <span>{t('condition.handleKeyTitle')}</span>
            <span>{t('condition.handleLogicalTitle')}</span>
            <span></span>
          </div>
          {handles.map(renderHandle)}
        </CssWrapper>
      )}
      {canEditSchema && handles.length === 0 && (
        <button data-drop-or-click="true" className={styles.dropTip} onClick={actionAdd?.onClick} type="button">
          <HandleIcon />
          <span className={styles.dropOr}>{t('handleEditor.dropOr')}</span>
          <i className="i-codicon:add" />
          <span className={styles.click}>{t('handleEditor.click')}</span>
        </button>
      )}
    </Card>
  )
})
