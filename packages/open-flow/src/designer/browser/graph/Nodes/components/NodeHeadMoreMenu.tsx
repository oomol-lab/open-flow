import styles from './NodeHead.module.scss'
import type { TFunction } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { DesignerStore } from '../../../stores/designer/designer.store.ts'
import type { FlowRunStatus } from '../../../stores/designer/typings.ts'
import type { NodeStore, NodeStoreDisplay$ } from '../../../stores/node/node.store.ts'

import { NodeToolbar, useStoreApi, useViewport } from '@xyflow/react'
import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../../ui/browser/button.tsx'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '../../../../../ui/browser/context-menu.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../../../ui/browser/dropdown-menu.tsx'
import { coalesce, identity, toggle, toTrue } from '../../../base/trivial.ts'
import { defaultTooltipClassName } from '../../../components/label.tsx'
import { DesignerTooltip } from '../../../components/tooltip.tsx'
import { iconOf } from '../../../jsonSchema/preset.ts'
import { getNextLang } from '../../../stores/designer/l10n.ts'
import { SUBFLOW_VIEW_MODE } from '../../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE, FLOW_RUN_STATUS } from '../../../stores/designer/typings.ts'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { NODE_STATUS } from '../../../stores/node/constants.ts'
import { ErrorNodeStore } from '../../../stores/node/errorNode.store.ts'
import { SubflowNodeStore } from '../../../stores/node/subflowNode.store.ts'
import { TaskNodeStore, toTaskNodeStore } from '../../../stores/node/taskNode.store.ts'
import { useDesignerStore } from '../../DesignerStoreContext.tsx'
import { useGetStaticPopupContainer } from '../../ReactFlowContainer/useGetPopupContainer.ts'
import { useSubflowViewMode } from '../../SubflowDesigner/SubflowViewModeContext.ts'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { NodeHeadBlockSettings } from './NodeHeadBlockSettings.tsx'
import { NodeStatusContent, NodeStatusIcon } from './NodeStatusLabel.tsx'
import { TranslateIcon } from './TranslateIcon.tsx'
import { useNodeStatus } from './useNodeStatus.ts'

export function NodeHeadMoreMenu(): React.ReactElement {
  const designerStore = useDesignerStore()
  const designerType = designerStore.designerType
  const subflowViewMode = useSubflowViewMode()
  const isInBlock = designerType === DESIGNER_TYPE.Block || subflowViewMode === SUBFLOW_VIEW_MODE.Block

  return isInBlock ? <InBlockDesigner designerStore={designerStore} /> : <InFlowDesigner designerStore={designerStore} />
}

// Node stores that can open a shared block Designer.
type SharedBlockNodeStore = TaskNodeStore | SubflowNodeStore

function isSharedBlockNodeStore(nodeStore: unknown): nodeStore is SharedBlockNodeStore {
  return TaskNodeStore.is(nodeStore) || SubflowNodeStore.is(nodeStore)
}

function toSharedBlockNodeStore(nodeStore: unknown): SharedBlockNodeStore | undefined {
  if (isSharedBlockNodeStore(nodeStore)) return nodeStore
}

interface SharedProps {
  readonly designerStore: DesignerStore
}

export interface NodeFloatBarProps {
  readonly designerStore: DesignerStore
  readonly nodeStore: NodeStore | CommentNodeStore
}

function InFlowDesigner({ designerStore }: SharedProps) {
  const t = useTranslate()
  const getStaticDesignerContainer = useGetStaticPopupContainer()
  const getPopupContainer = getStaticDesignerContainer
  const nodeStore = useNodeStore()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const sharedBlockNodeStore = toSharedBlockNodeStore(nodeStore)
  const runStatus = useVal(designerStore.$.runStatus)
  const editable = useVal(designerStore.$.editable)

  const onOpenBlockDesigner = sharedBlockNodeStore?.openBlockDesigner
  const onOpenSharedTaskSource = taskNodeStore?.openSharedTaskSource
  const onToggleSettings = toggle(nodeStore.$$.showSettings)

  const onDelete = toTrue(editable) && (() => designerStore.deleteNodes([nodeStore]))
  const items = getContextMenuItems({
    t,
    nodeStore,
    runStatus,
    onToggleSettings,
    onDelete,
    onOpenSharedTaskSource,
    onOpenBlockDesigner,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={t('more')} size="icon-xs" title={t('more')} variant="ghost">
            <i className="i-codicon:ellipsis" />
          </Button>
        }
      />
      <NodeHeadMenuContent getPopupContainer={getPopupContainer} items={items} />
    </DropdownMenu>
  )
}

export function NodeSettingsPanelHost({ designerStore, nodeStore }: NodeFloatBarProps): React.ReactElement | null {
  const showSettings = useVal(nodeStore.$.showSettings)
  const editable = useVal(designerStore.$.editable)
  const reactFlowStore = useStoreApi()

  if (!showSettings) return null

  const onDelete = toTrue(editable && designerStore.canDeleteNodes) && (() => designerStore.deleteNodes([nodeStore]))

  return (
    <div className={styles.blockSettings}>
      <NodeHeadBlockSettings
        isFlowDesigner={true}
        reactFlowStore={reactFlowStore}
        panelWidth$={designerStore.$$.settingsPanelWidth}
        showSettings$={nodeStore.$$.showSettings}
        onDelete={onDelete}
      />
    </div>
  )
}

function InBlockDesigner({ designerStore }: SharedProps) {
  const t = useTranslate()
  const nodeStore = useNodeStore()
  const showSettings = useVal(nodeStore.$$.showSettings)
  const reactFlowStore = useStoreApi()

  return (
    <>
      <Button
        aria-label={t('nodeActions.nodeSetting')}
        aria-pressed={showSettings}
        onClick={toggle(nodeStore.$$.showSettings)}
        size="icon-xs"
        title={t('nodeActions.nodeSetting')}
        variant={showSettings ? 'default' : 'ghost'}
      >
        <i className={iconOf('settings')} />
      </Button>
      {showSettings && (
        <div className={styles.blockSettings}>
          <NodeHeadBlockSettings
            isFlowDesigner={false}
            reactFlowStore={reactFlowStore}
            panelWidth$={designerStore.$$.settingsPanelWidth}
            showSettings$={nodeStore.$$.showSettings}
            onDelete={nodeStore.remove}
          />
        </div>
      )}
    </>
  )
}

export interface NodeHeadContextMenuProps {
  readonly designerStore: DesignerStore
  readonly children?: React.ReactNode
}

export function NodeHeadContextMenu({ designerStore, children }: NodeHeadContextMenuProps): React.ReactElement {
  const t = useTranslate()
  const getStaticDesignerContainer = useGetStaticPopupContainer()
  const getPopupContainer = getStaticDesignerContainer
  const nodeStore = useNodeStore()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const sharedBlockNodeStore = toSharedBlockNodeStore(nodeStore)
  const runStatus = useVal(designerStore.$.runStatus)
  const editable = useVal(designerStore.$.editable)
  const subflowViewMode = useSubflowViewMode()
  const isInBlock = designerStore.designerType === DESIGNER_TYPE.Block || subflowViewMode === SUBFLOW_VIEW_MODE.Block

  const onOpenBlockDesigner = sharedBlockNodeStore?.openBlockDesigner
  const onOpenSharedTaskSource = taskNodeStore?.openSharedTaskSource
  const onToggleSettings = toggle(nodeStore.$$.showSettings)

  const onDelete = toTrue(editable && designerStore.canDeleteNodes && !isInBlock) && (() => designerStore.deleteNodes([nodeStore]))
  const items = getContextMenuItems({
    t,
    nodeStore,
    runStatus,
    onToggleSettings,
    onDelete,
    onOpenBlockDesigner,
    onOpenSharedTaskSource,
  })

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex-1">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className={styles.menu} container={getPopupContainer()}>
        <ContextMenuGroup>
          {items.map(
            (item) =>
              item && (
                <ContextMenuItem key={item.key} disabled={item.disabled} onClick={item.onClick} variant={item.danger ? 'destructive' : 'default'}>
                  {item.icon}
                  {item.label}
                </ContextMenuItem>
              ),
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface Params {
  readonly t: TFunction
  readonly nodeStore: NodeStore | CommentNodeStore
  readonly runStatus: FlowRunStatus
  readonly includeExecuteWithCache?: true
  readonly onToggleSettings?: () => void
  readonly onDelete?: () => void
  readonly onOpenSharedTaskSource?: () => void
  readonly onOpenBlockDesigner?: () => void
}

interface ContextMenuActionItem {
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly icon?: React.ReactNode
  readonly key: string
  readonly label: string
  readonly onClick?: () => void
}

type ContextMenuItem = ContextMenuActionItem | false | undefined

function NodeHeadMenuContent({ getPopupContainer, items }: { readonly getPopupContainer: () => HTMLElement; readonly items: ContextMenuItem[] }) {
  return (
    <DropdownMenuContent align="start" className={styles.menu} container={getPopupContainer()} side="bottom" sideOffset={0}>
      <DropdownMenuGroup>
        {items.map(
          (item) =>
            item && (
              <DropdownMenuItem key={item.key} disabled={item.disabled} onClick={item.onClick} variant={item.danger ? 'destructive' : 'default'}>
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ),
        )}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}

function getContextMenuItems({
  t,
  nodeStore,
  runStatus,
  includeExecuteWithCache,
  onToggleSettings,
  onDelete,
  onOpenBlockDesigner,
  onOpenSharedTaskSource,
}: Params): ContextMenuItem[] {
  const skip = useVal(nodeStore.display$?.ignore)
  const { duplicateNode, execute } = nodeStore
  const isErrorNode = ErrorNodeStore.is(nodeStore)
  const commentNode = CommentNodeStore.is(nodeStore) ? nodeStore : undefined
  const commentLang = useVal(commentNode?.$.lang)
  const translateKey = useVal(commentNode?.$.translateKey)

  return coalesce<ContextMenuItem>([
    identity(includeExecuteWithCache && execute) && {
      label: t('nodeActions.execute'),
      key: '$executeWithCache',
      icon: <i className="i-codicon:play" />,
      disabled: skip || runStatus !== FLOW_RUN_STATUS.Idle,
      onClick: () => execute?.(true),
    },
    execute && {
      label: t('nodeActions.executeWithoutCache'),
      key: '$executeWithoutCache',
      icon: <i className="i-codicon:run-all" />,
      disabled: skip || runStatus !== FLOW_RUN_STATUS.Idle,
      onClick: () => execute(false),
    },
    duplicateNode && {
      label: t('nodeActions.duplicate'),
      key: '$duplicate',
      icon: <i className="i-codicon:copy" />,
      onClick: () => duplicateNode(),
    },
    toTrue(!isErrorNode && !!nodeStore.display$) && {
      label: skip ? t('nodeActions.skipDisable') : t('nodeActions.skipEnable'),
      key: '$skip',
      icon: <i className={skip ? 'i-carbon:view-off' : 'i-carbon:view'} />,
      onClick: () => nodeStore.display$?.ignore.set(!skip),
    },
    onOpenSharedTaskSource && {
      label: t('nodeActions.openSharedBlockCode'),
      key: '$openSharedBlockCode',
      icon: <i className="i-codicon:code" />,
      onClick: onOpenSharedTaskSource,
    },
    onOpenBlockDesigner && {
      label: t('nodeActions.configSharedBlock'),
      key: '$configSharedBlock',
      icon: <i className="i-codicon:layers" />,
      onClick: onOpenBlockDesigner,
    },
    toTrue(!isErrorNode && !!onToggleSettings) && {
      label: t('nodeActions.nodeSetting'),
      key: '$nodeSetting',
      icon: <i className={iconOf('settings')} />,
      onClick: onToggleSettings,
    },
    commentNode?.$.translateKey &&
      (translateKey != null
        ? commentNode.toggleLanguage && {
            label: t('nodeActions.toggleLanguage', { lang: t(`l10n.${getNextLang(commentLang)}`) }),
            key: '$toggleLanguage',
            icon: <TranslateIcon translateLang={commentLang} />,
            onClick: () => {
              commentNode.toggleLanguage!()
            },
          }
        : commentNode.createTranslateKey && {
            label: t('l10n.createKey'),
            key: '$enableI18n',
            icon: <i className="i-carbon:translate" />,
            onClick: () => {
              commentNode.createTranslateKey!()
            },
          }),
    onDelete && {
      label: t('nodeActions.delete'),
      key: '$delete',
      icon: <i className="i-codicon:trash" />,
      danger: true,
      onClick: onDelete,
    },
  ])
}

export const NodeFloatBar: React.FC<NodeFloatBarProps> = /* @__PURE__ */ memo(function NodeFloatBar({ designerStore, nodeStore }) {
  const t = useTranslate()
  const { zoom } = useViewport()
  const taskNodeStore = toTaskNodeStore(nodeStore)
  const runStatus = useVal(designerStore.$.runStatus)
  const showSettings = useVal(nodeStore.$.showSettings)
  const getPopupContainer = useGetStaticPopupContainer()

  const onOpenSharedTaskSource = taskNodeStore?.openSharedTaskSource
  const onToggleSettings = toggle(nodeStore.$$.showSettings)

  const items = getContextMenuItems({
    t,
    nodeStore,
    runStatus,
    includeExecuteWithCache: true,
    onToggleSettings,
    onOpenSharedTaskSource,
  })
  const floatBarItems = items.filter((item): item is ContextMenuActionItem => !!item)

  return (
    <NodeToolbar className={styles.floatBar} offset={4 - 8 * zoom}>
      {nodeStore.display$ && <NodeStatus flowStatus$={designerStore.$.runStatus} display$={nodeStore.display$} />}
      {floatBarItems.map((item) => {
        const active = item.key === '$nodeSetting' && showSettings
        return (
          <DesignerTooltip getPopupContainer={getPopupContainer} key={item.key} placement="top" title={item.label}>
            <Button
              aria-label={item.label}
              aria-pressed={active}
              className={styles.floatBarButton}
              disabled={item.disabled}
              onClick={item.onClick}
              size="icon"
              variant={active ? 'default' : 'ghost'}
            >
              {item.icon}
            </Button>
          </DesignerTooltip>
        )
      })}
    </NodeToolbar>
  )
})

interface NodeStatusProps {
  flowStatus$: ReadonlyVal<FlowRunStatus>
  display$: NodeStoreDisplay$
}

function NodeStatus({ flowStatus$, display$ }: NodeStatusProps): React.ReactNode {
  const skip = useVal(display$.ignore, true)
  const progress = useVal(display$.progress, true)
  const { status, count } = useNodeStatus(display$.status, flowStatus$, display$.successCount)
  const getPopupContainer = useGetStaticPopupContainer()

  if (skip) return

  switch (status) {
    case NODE_STATUS.Success:
    case NODE_STATUS.Error:
    case NODE_STATUS.Running:
    case NODE_STATUS.Waiting:
      return (
        <DesignerTooltip
          className={defaultTooltipClassName}
          placement="top"
          getPopupContainer={getPopupContainer}
          title={<NodeStatusContent status={status} progress={progress} combo={count} />}
        >
          <span className={styles.floatBarStatus}>
            <NodeStatusIcon status={status} progress={progress} loaderSize={18} />
          </span>
        </DesignerTooltip>
      )
  }
}
