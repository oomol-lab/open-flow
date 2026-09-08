import styles from './FlowSettings.module.scss'
import type { Val } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { IHandleAction } from '../../components/handleRow.tsx'
import type { DesignerType } from '../../stores/designer/typings.ts'

import { useCallback, useRef, useState } from 'react'
import { useDerived, useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { setValue } from 'value-enhancer'
import { Button } from '../../../../ui/browser/button.tsx'
import { asTrue, toTrue } from '../../base/trivial.ts'
import { CssWrapper } from '../../components/cssWrapper.tsx'
import { HandleNoActions, HandleWithActions } from '../../components/handleNoActions.tsx'
import { HandleRow } from '../../components/handleRow.tsx'
import { TranslationInput } from '../../components/input2.tsx'
import { Label } from '../../components/label.tsx'
import { DesignerCombobox as Select } from '../../components/select.tsx'
import { LabeledSwitch } from '../../components/toggleSwitch.tsx'
import { DesignerTooltip } from '../../components/tooltip.tsx'
import { DesignerIcon } from '../../icons/DesignerIcon.tsx'
import { iconOf } from '../../jsonSchema/preset.ts'
import { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import { SubflowDesignerStore } from '../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../stores/designer/typings.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { useOpenIconPicker } from '../iconPicker.tsx'
import { defaultFlowIcon, defaultNodeIcon, defaultSubflowIcon } from '../Nodes/components/constants.ts'

export interface FlowSettingsProps {
  readonly designerType: DesignerType
  readonly showSettings$?: Val<boolean>
  readonly panelWidth$: Val<number | undefined>
}

const MIN_CONFIG_WIDTH = 365

export function FlowSettings(props: FlowSettingsProps): React.ReactElement {
  const t = useTranslate()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleTrack = useHandleTrack(MIN_CONFIG_WIDTH, props.panelWidth$, containerRef)

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <div data-pos="w" className={`${styles.resizeHandle} ${styles.resizeHandleW}`} onPointerDown={handleTrack} />
      <header className={styles.header}>
        <h3 className={styles.title}>{props.designerType === DESIGNER_TYPE.Subflow ? t('subflowSettings.title') : t('flowSettings.title')}</h3>
        <aside>
          {props.showSettings$ && (
            <Button aria-label={t('close')} onClick={() => setValue(props.showSettings$!, false)} size="icon-xs" title={t('close')} variant="ghost">
              <i className="i-codicon:close" />
            </Button>
          )}
        </aside>
      </header>
      <div className={`nodrag ${styles.content}`}>
        <HandleNoActions>
          <CssWrapper css={{ '--name-factor': 3, '--value-factor': 4 }}>
            <Configs />
          </CssWrapper>
        </HandleNoActions>
      </div>
    </div>
  )
}

function Configs() {
  const t = useTranslate()
  const designerStore = useDesignerStore()
  const [metadataExpanded, setMetadataExpanded] = useState(true)
  const [forwardPreviewExpanded, setForwardPreviewExpanded] = useState(false)

  return FlowDesignerStore.is(designerStore) || SubflowDesignerStore.is(designerStore) ? (
    <>
      <HandleRow
        variant="value-only"
        value={<div className={styles.subtitle}>{t('blockEditor.metadata')}</div>}
        valueExpands
        expanded={metadataExpanded}
        onExpandedChange={setMetadataExpanded}
      />
      {metadataExpanded && <MetadataConfigs store={designerStore} />}
      {SubflowDesignerStore.is(designerStore) && designerStore.display$?.forward_previews && (
        <>
          <HandleRow
            variant="value-only"
            value={<div className={styles.subtitle}>{t('subflowSettings.forwardPreview')}</div>}
            valueExpands
            expanded={forwardPreviewExpanded}
            onExpandedChange={setForwardPreviewExpanded}
          />
          {forwardPreviewExpanded && <ForwardPreviewConfigs store={designerStore} />}
        </>
      )}
    </>
  ) : null
}

function ForwardPreviewConfigs({ store }: { readonly store: SubflowDesignerStore }) {
  const t = useTranslate()

  const editable = useVal(store.$.editable)
  const nodesCount = useDerived(store.$.nodes.$, (nodes) => nodes.size)
  const displayNodeIds = useVal(store.display$.forward_previews)
  const options = useVal(store.$.forwardPreviewOptions)
  const [menuAt, setMenuAt] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const canAddNode = store.manifest$?.forward_previews != null && (displayNodeIds?.length || 0) < nodesCount

  const doAddNode = useCallback(
    (nodeId: NodeId, index: number): void => {
      const nodeIds$ = store.manifest$?.forward_previews
      if (nodeIds$ && !nodeIds$.value?.includes(nodeId)) {
        let nodeIds = nodeIds$.value?.slice() || []
        nodeIds.splice(index + 1, 0, nodeId)
        setValue(nodeIds$, nodeIds)
      }
    },
    [store],
  )

  const onClickNodeAdd = useCallback((index: number): void => {
    setMenuAt(index)
    setMenuOpen(true)
  }, [])

  const onClickNodeDelete = useCallback(
    (nodeId: NodeId): void => {
      const nodeIds$ = store.manifest$?.forward_previews
      if (nodeIds$ && nodeIds$.value) {
        setValue(
          nodeIds$,
          nodeIds$.value.filter((id) => id !== nodeId),
        )
      }
    },
    [store],
  )

  const onMenuClose = useCallback(() => {
    setMenuAt(-1)
    setMenuOpen(false)
  }, [])

  const children: React.ReactNode[] = []

  const below = (displayNodeIds?.length || 0) - menuAt - 1

  const addNodeButton = menuOpen ? (
    <Select
      defaultOpen
      options={options}
      onChange={(e) => e && doAddNode(e.value, menuAt)}
      onClose={onMenuClose}
      disabled={!canAddNode}
      maxMenuHeight={Math.max(0, below) * 27 + 55}
    />
  ) : (
    <Button disabled={!editable || !canAddNode} onClick={() => setMenuOpen(true)}>
      <i className={iconOf('objectAdd')} data-icon="inline-start" />
      {t('handleEditor.addItem')}
    </Button>
  )

  if (displayNodeIds?.length) {
    for (let index = 0; index < displayNodeIds.length; index++) {
      const nodeId = displayNodeIds[index]
      const isLast = index === displayNodeIds.length - 1
      children.push(
        <ForwardPreviewNode
          key={nodeId}
          store={store}
          nodeId={nodeId}
          index={index}
          isLast={isLast && menuAt < displayNodeIds.length - 1}
          onAdd={toTrue(canAddNode) && onClickNodeAdd}
          onDelete={onClickNodeDelete}
        />,
      )
      if (menuOpen && index === menuAt) {
        const row = <HandleRow key="[add-node-button]" level=" " variant="value-only" value={addNodeButton} isLast={isLast} />
        children.push(row)
      }
    }
    if (menuOpen && menuAt >= displayNodeIds.length) {
      const row = <HandleRow key="[add-node-button]" level=" " variant="value-only" value={addNodeButton} isLast />
      children.push(row)
    }
  } else {
    const row = (
      <HandleNoActions key="[add-node-button]">
        <HandleRow level=" " variant="value-only" value={addNodeButton} suffix={null} />
      </HandleNoActions>
    )
    children.push(row)
  }

  return <HandleWithActions>{children}</HandleWithActions>
}

interface ForwardPreviewNodeProps {
  readonly index: number
  readonly store: SubflowDesignerStore
  readonly nodeId: NodeId
  readonly isLast: boolean
  readonly onAdd?: (index: number) => void
  readonly onDelete: (nodeId: NodeId) => void
}

function ForwardPreviewNode(props: ForwardPreviewNodeProps) {
  const t = useTranslate()
  const node = useDerived(props.store.$.nodes.$, (nodes) => nodes.get(props.nodeId))
  const displayIcon = useVal(node?.display$.icon)
  const title = useVal(node?.display$.title) || node?.nodeId
  const description = useVal(node?.display$.description)
  const canEditValue = props.store.manifest$?.forward_previews != null

  const actionAdd: IHandleAction = {
    icon: iconOf('objectAdd'),
    title: t('handleEditor.addItem'),
    disabled: !props.onAdd || !canEditValue,
    onClick: () => props.onAdd?.(props.index),
  }

  const actionDelete: IHandleAction = {
    icon: iconOf('objectDelete'),
    title: t('nodeActions.delete'),
    disabled: !canEditValue,
    onClick: () => props.onDelete(props.nodeId),
  }

  if (!node) return null

  return (
    <HandleRow
      level=" "
      isLast={props.isLast}
      variant="value-only"
      value={
        <div className={styles.forwardPreviewNode} title={[title, node.nodeId, description].filter((x) => !!x).join('\n')}>
          <DesignerIcon src={displayIcon} fallback={<i className={defaultNodeIcon} />} />
          <span className={styles.forwardPreviewNodeTitle}>{title}</span>
        </div>
      }
      actions={[actionAdd, actionDelete]}
    />
  )
}

function MetadataConfigs({ store }: { readonly store: FlowDesignerStore | SubflowDesignerStore }) {
  const t = useTranslate()
  const isSubflow = SubflowDesignerStore.is(store)

  const privateValue = useVal(isSubflow && store.manifest$?.private)

  const editable = useVal(store.$.editable)

  const displayIcon = useVal(store.display$.icon)
  const displayDescription = useVal(store.display$.description)

  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const toggleDescription = () => setDescriptionExpanded((e) => !e)
  const openIconPicker = useOpenIconPicker()

  const fallbackIcon = isSubflow ? <i className={defaultSubflowIcon} /> : <i className={defaultFlowIcon} />

  return (
    <>
      <HandleRow
        level=" "
        isLast={false}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="icon">
            {t('blockEditor.icon')}
          </Label>
        }
        value={
          store.manifest$ && editable ? (
            <Button className={styles.iconButton} onClick={() => openIconPicker(store.manifest$!.icon!.set, 'top')} size="icon-xs" variant="ghost">
              <DesignerIcon src={displayIcon} fallback={fallbackIcon} />
            </Button>
          ) : (
            <DesignerIcon src={displayIcon} fallback={fallbackIcon} />
          )
        }
      />
      {isSubflow && store.manifest$?.private && (
        <HandleRow
          level=" "
          isLast={false}
          name={
            <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="private">
              {t('blockEditor.privateField')}{' '}
              <DesignerTooltip placement="top" title={t('blockEditor.privateHelp')}>
                <span className="cursor-help mr-1 text-[1.2em]">
                  <i className="i-codicon:question" />
                </span>
              </DesignerTooltip>
            </Label>
          }
          value={
            <LabeledSwitch
              label={{ true: t('blockEditor.private'), false: t('blockEditor.public') }}
              checked={asTrue(privateValue)}
              onChange={store.manifest$.private.set}
            />
          }
        />
      )}
      <HandleRow
        level=" "
        isLast={false}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="title">
            {t('blockEditor.title')}
          </Label>
        }
        value={
          <TranslationInput
            className={styles.input}
            displayValue$={store.display$.title}
            rawValue$={toTrue(editable) && store.manifest$?.title}
            placeholder={t('inputHandleEditor.unset')}
            useRealChange
          />
        }
      />
      <HandleRow
        level=" "
        expanded={descriptionExpanded}
        onExpandedChange={setDescriptionExpanded}
        name={
          <Label className={styles.label} tooltipClassName={styles.labelTooltip} title="description">
            {t('blockEditor.description')}
          </Label>
        }
        value={
          <Button className={styles.expandButton} onClick={toggleDescription} title={displayDescription} variant="ghost">
            <span>{displayDescription}</span>
          </Button>
        }
      />
      {descriptionExpanded && (
        <HandleRow
          resizable
          level="  "
          variant="value-only"
          value={
            <TranslationInput
              multiline
              className={styles.input}
              displayValue$={store.display$.description}
              rawValue$={toTrue(editable) && store.manifest$?.description}
              placeholder={t('inputHandleEditor.unset')}
              useRealChange
            />
          }
        />
      )}
    </>
  )
}

function useHandleTrack(minWidth: number, width$: Val<number | undefined>, containerRef: React.RefObject<HTMLDivElement | null>) {
  return useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!event.isPrimary || event.target !== event.currentTarget || (event.button != null && event.button !== 0)) {
        return
      }

      const deltaDirection = 1

      event.preventDefault()
      event.stopPropagation()

      const startPointerX = event.clientX

      const startWidth = width$.value !== undefined ? Math.max(minWidth, width$.value) : minWidth

      function handleTrackMove(pointerEvent: PointerEvent): void {
        if (!pointerEvent.isPrimary) {
          return
        }

        if (pointerEvent.buttons <= 0) {
          handleTrackEnd()
          return
        }

        pointerEvent.preventDefault()
        pointerEvent.stopPropagation()

        const nodeDeltaX = (startPointerX - pointerEvent.clientX) * deltaDirection

        const width = Math.max(minWidth, startWidth + nodeDeltaX)

        width$.set(width)
        containerRef.current?.style.setProperty('width', `${width}px`)
      }

      function handleTrackEnd(): void {
        window.removeEventListener('pointermove', handleTrackMove)
        window.removeEventListener('pointerup', handleTrackEnd)
        window.removeEventListener('pointercancel', handleTrackEnd)
        window.removeEventListener('blur', handleTrackEnd)
      }

      window.addEventListener('pointermove', handleTrackMove)
      window.addEventListener('pointerup', handleTrackEnd, { passive: true })
      window.addEventListener('pointercancel', handleTrackEnd, {
        passive: true,
      })
      window.addEventListener('blur', handleTrackEnd, { passive: true })
    },
    [minWidth, width$],
  )
}
