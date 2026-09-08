import styles from './EmptyNodeContent.module.scss'
import type { TaskNodeStore } from '../../../stores/node/taskNode.store.ts'

import { useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { compute } from 'value-enhancer'
import { isWorkspaceBlock } from '../../../base/trivial.ts'
import { SUBFLOW_VIEW_MODE } from '../../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../../stores/designer/typings.ts'
import { InputSectionStore } from '../../../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../../../stores/node/nodeSection/outputSection.store.ts'
import { SubflowNodeStore } from '../../../stores/node/subflowNode.store.ts'
import { useDesignerType } from '../../DesignerStoreContext.tsx'
import { useSubflowViewMode } from '../../SubflowDesigner/SubflowViewModeContext.ts'

export interface EmptyNodeContentProps {
  readonly store: TaskNodeStore | SubflowNodeStore
}

export function EmptyNodeContent(props: EmptyNodeContentProps): React.ReactElement | null {
  const t = useTranslate()
  const isBlockDesigner = useDesignerType() === DESIGNER_TYPE.Block
  const isSubflowBlock = useSubflowViewMode() === SUBFLOW_VIEW_MODE.Block
  const isInFlow = !(isBlockDesigner || isSubflowBlock)

  const blockResourceName = useVal(SubflowNodeStore.is(props.store) ? props.store.display$.subflow : props.store.display$.task)
  const isSelf = isWorkspaceBlock(blockResourceName)

  const isEmpty$ = useMemo(
    () =>
      compute((get) => {
        if (get(props.store.runtimeSections$).length > 0) return false
        let inputEmpty = true
        let outputEmpty = true
        for (const section of get(props.store.display$.sections)) {
          if (InputSectionStore.is(section)) {
            inputEmpty = get(section.$.isEmpty)
          } else if (OutputSectionStore.is(section)) {
            outputEmpty = get(section.$.isEmpty)
          }
        }
        return inputEmpty && outputEmpty
      }),
    [props.store],
  )
  const isEmpty = useVal(isEmpty$)

  const canEditSchema = isSelf && isInFlow && props.store.openBlockDesigner

  if (!isEmpty) return null

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {canEditSchema ? (
          <button data-node-empty="true" className={styles.tip} onClick={props.store.openBlockDesigner} type="button">
            <i className="i-codicon:edit" />
            <span className={styles.click}>{t('handleEditor.editSharedBlock')}</span>
          </button>
        ) : (
          <div className={styles.tip}>
            <i className="i-codicon:inbox" />
            <span className={styles.click}>{t('handleEditor.noInputOutput')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
