import styles from './GroupedHandles.module.scss'
import type { InputSectionStore } from '../../stores/node/nodeSection/inputSection.store.ts'
import type { OutputSectionStore } from '../../stores/node/nodeSection/outputSection.store.ts'
import type { SubflowInputSectionStore } from '../../stores/node/nodeSection/subflowInputSection.store.ts'
import type { SubflowOutputSectionStore } from '../../stores/node/nodeSection/subflowOutputSection.store.ts'
import type { useDragAndDrop } from './dragNDrop.ts'

import { clsx } from 'clsx'
import { useCallback, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { compute, val } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { isBannedName, toTrue } from '../../base/trivial.ts'
import { HandleRow } from '../../components/handleRow.tsx'
import { Input } from '../../components/input.tsx'
import { defaultTooltipClassName } from '../../components/label.tsx'
import { DesignerTooltip } from '../../components/tooltip.tsx'
import { DESIGNER_TYPE } from '../../stores/designer/typings.ts'
import { OUTPUT_SECTION_TYPE, SUBFLOW_INPUT_SECTION_TYPE, SUBFLOW_OUTPUT_SECTION_TYPE } from '../../stores/node/nodeSection/constants.ts'
import { HandleRowStore } from '../../stores/nodeHandle/handleRow.store.ts'
import { useDesignerType } from '../DesignerStoreContext.tsx'

type ISectionHasGroups = InputSectionStore | OutputSectionStore | SubflowInputSectionStore | SubflowOutputSectionStore

export interface GroupedHandlesProps {
  readonly isConditionNode?: boolean
  readonly section: ISectionHasGroups
  readonly handles: (HandleRowStore | string)[]
  readonly renderHandle: (handle: HandleRowStore) => React.ReactNode
  readonly dnd: ReturnType<typeof useDragAndDrop>
}

export function GroupedHandles(props: GroupedHandlesProps): React.ReactElement {
  const t = useTranslate()
  const { isConditionNode, section, handles, dnd } = props
  const [ungrouped, groups, additionalGroup] = useMemo(() => getGroups(handles, isConditionNode), [handles, isConditionNode])
  const canEditGroups = section.canEditGroups
  const isOutput = section.type === OUTPUT_SECTION_TYPE || section.type === SUBFLOW_OUTPUT_SECTION_TYPE

  return (
    <>
      {ungrouped.map(props.renderHandle)}
      {groups.map((item) => (
        <HandleGroup
          key={item.group}
          section={section}
          editable={canEditGroups}
          group={item.group}
          handles={item.handles}
          renderHandle={props.renderHandle}
          dnd={dnd}
        />
      ))}
      {canEditGroups && dnd.dragHandle?.handle != null && !isConditionNode && (
        <EmptyGroup onDragOver={dnd.onDragOver} onDrop={() => section.addGroup(dnd.dragHandle!.handle!)} />
      )}
      {additionalGroup && (
        <HandleGroup
          additional
          section={section}
          editable={canEditGroups}
          group={isOutput ? t('handleEditor.additionalOutputs') : t('handleEditor.additionalInputs')}
          handles={additionalGroup.handles}
          renderHandle={props.renderHandle}
          dnd={toTrue(isConditionNode) && dnd}
        />
      )}
    </>
  )
}

interface HandleGroupProps {
  readonly section: ISectionHasGroups
  readonly editable: boolean
  readonly group: string
  readonly handles: HandleRowStore[]
  readonly additional?: boolean
  readonly renderHandle: (handle: HandleRowStore) => React.ReactNode
  readonly dnd?: ReturnType<typeof useDragAndDrop>
}

function HandleGroup(props: HandleGroupProps) {
  const t = useTranslate()
  const isInFlow = useDesignerType() === DESIGNER_TYPE.Flow
  const { section, handles, dnd } = props
  const isPseudo = section.type === SUBFLOW_INPUT_SECTION_TYPE || section.type === SUBFLOW_OUTPUT_SECTION_TYPE

  const allHandlesAreConnectedOrError$ = useMemo(
    () => compute((get) => handles.every((handle) => get(handle.reference$) || (isInFlow && get(handle.error$)))),
    [handles, isInFlow],
  )
  const canToggle = !useVal(allHandlesAreConnectedOrError$) && !props.additional && !isPseudo

  const groupCollapsed = useVal(props.section.$.groupCollapsed)
  const open = canToggle ? !groupCollapsed?.[props.group] : handles.length > 0

  const allGroupNames = useVal(props.section.$.allGroupNames)
  const validateName = useCallback(
    (name: string, oldName: string): string | undefined => {
      if (!name) return t('handleGroup.renaming.empty')
      if (name === oldName) return
      if (isBannedName(name)) {
        return t('handleGroup.renaming.banned', { name })
      }
      if (allGroupNames.includes(name)) {
        return t('handleGroup.renaming.duplicate')
      }
    },
    [allGroupNames, t],
  )

  const renameError$ = useMemo(() => val<string | undefined>(), [])
  const onUpdateName = useCallback((name: string): void => renameError$.set(validateName(name, props.group)), [renameError$, props.group, validateName])
  const onCommit = useCallback(
    (name: string) => {
      if (renameError$.value) {
        return
      } else if (name !== props.group) {
        section.renameGroup(props.group, name)
      } else {
        renameError$.set(undefined)
      }
    },
    [props.group, section],
  )
  const renameError = useVal(renameError$)

  return (
    <>
      {dnd && dnd.dragTarget && dnd.dragTarget.handle == null && dnd.dragTarget.group === props.group && toTrue(dnd.dragPosition < 0) && (
        <div className={styles.dragIndicator} />
      )}
      <HandleRow
        className={`${NODE_HANDLE_CLASSNAME} ${styles.group}`}
        variant="value-only"
        expanded={open}
        onExpandedChange={() => section.toggleGroup(props.group)}
        expandedDisabled={!canToggle}
        prefix={
          !props.additional &&
          props.editable &&
          dnd && (
            <div draggable className={`${styles.dragHandle} nodrag`} onDragStart={(ev) => dnd.onDragStart(ev, props.group)} data-handle={`g:${props.group}`}>
              <i className="i-carbon:draggable" />
            </div>
          )
        }
        value={
          <DesignerTooltip className={defaultTooltipClassName} placement="left" title={renameError} open={!!renameError}>
            <div className={styles.handleNameWrapper}>
              <Input
                returnToCommit
                doubleClickToSelect
                className={clsx(styles.groupName, renameError && styles.renameError)}
                placeholder={t('handleGroup.fallback')}
                value={props.group}
                title={props.group}
                disabled={!props.editable || props.additional}
                onChange={onUpdateName}
                onRealChange={onCommit}
                onBlur={(input) => {
                  input.value = props.group
                  renameError$.set(undefined)
                }}
              />
            </div>
          </DesignerTooltip>
        }
        actions={
          toTrue(props.editable && !props.additional) && [
            null,
            {
              title: t('handleGroup.delete'),
              icon: 'i-codicon:trash',
              onClick: () => section.deleteGroup(props.group),
            },
          ]
        }
        onDragOver={props.additional ? void 0 : dnd && ((ev) => dnd.onDragOver(ev, props.group))}
      />
      {dnd && dnd.dragTarget && dnd.dragTarget.handle == null && dnd.dragTarget.group === props.group && toTrue(dnd.dragPosition > 0) && (
        <div className={styles.dragIndicator} />
      )}
      {handles.map((handle) => (
        <OpenHandle key={handle.name} open={open} handle={handle}>
          {props.renderHandle(handle)}
        </OpenHandle>
      ))}
    </>
  )
}

interface OpenHandleProps {
  readonly open: boolean
  readonly handle: HandleRowStore
  readonly children: React.ReactNode
}

function OpenHandle({ open, handle, children }: OpenHandleProps) {
  const isInFlow = useDesignerType() === DESIGNER_TYPE.Flow
  const connected = useVal(handle.reference$)
  const error = useVal(handle.error$)
  return connected || (isInFlow && error) || open ? children : null
}

interface EmptyGroupProps {
  readonly onDragOver: (event: React.DragEvent<HTMLElement>, store: null) => void
  readonly onDrop: (event: React.DragEvent) => void
}

function EmptyGroup(props: EmptyGroupProps) {
  const t = useTranslate()
  const [active, setActive] = useState(false)

  return (
    <div
      className={styles.groupHeader}
      onDragEnter={(event) => {
        event.preventDefault()
        setActive(true)
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setActive(false)
      }}
      onDragOver={(event) => {
        props.onDragOver(event, null)
        setActive(true)
      }}
      onDrop={(event) => {
        setActive(false)
        props.onDrop(event)
      }}
    >
      <span className={clsx(styles.groupAddTip, active && styles.groupAddTipActive)}>
        <i className="i-codicon:add" />
        <span className={styles.groupAddTipText}>{t('handleGroup.dropAdd')}</span>
      </span>
    </div>
  )
}

interface HandlesGroup {
  readonly group: string
  readonly handles: HandleRowStore[]
}

/**
 * When `isConditionNode` is `true`, every handle after the first one is additional.
 */
function getGroups(
  handles: (HandleRowStore | string)[],
  isConditionNode?: boolean,
): [ungrouped: HandleRowStore[], groups: HandlesGroup[], additional: HandlesGroup | undefined] {
  const ungrouped: HandleRowStore[] = []
  const groups: HandlesGroup[] = []
  const additional: HandleRowStore[] = []

  if (isConditionNode) {
    let foundFirst = false
    for (const item of handles) {
      if (HandleRowStore.is(item)) {
        if (foundFirst) {
          additional.push(item)
        } else {
          ungrouped.push(item)
          foundFirst = true
        }
      }
    }
  } else {
    let currentGroup: HandlesGroup | undefined

    for (const item of handles) {
      if (HandleRowStore.is(item)) {
        if (item.context.additional) {
          additional.push(item)
        } else if (currentGroup) {
          currentGroup.handles.push(item)
        } else {
          ungrouped.push(item)
        }
      } else {
        currentGroup = { group: item, handles: [] }
        groups.push(currentGroup)
      }
    }
  }

  let additionalGroup: HandlesGroup | undefined
  if (additional.length > 0) {
    additionalGroup = { group: '', handles: additional }
  }

  return [ungrouped, groups, additionalGroup]
}
