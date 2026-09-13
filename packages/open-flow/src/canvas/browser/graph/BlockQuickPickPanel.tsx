import styles from './BlockQuickPickPanel.module.scss'
import type { DragEventHandler, MouseEventHandler, ReactNode } from 'react'
import type { FlowCanvasViewAddItem, FlowCanvasViewProps } from './FlowCanvas/model.ts'
import type { NodePickerItem } from './nodePickerItems.ts'

import { clsx } from 'clsx'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { useCollectionItems } from '../../../ui/browser/collectionSearch.ts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../ui/browser/icons/ContentIcon.tsx'
import { ScrollArea } from '../../../ui/browser/scroll-area.tsx'
import { setTriggerType } from '../base/dragNDrop.ts'
import { toTrue } from '../base/trivial.ts'
import { Input } from '../components/input.tsx'
import { nodePickerItems } from './nodePickerItems.ts'
import { defaultNodeIcon, defaultTriggerIcon } from './Nodes/components/constants.ts'
import { useGetStaticPopupContainer } from './ReactFlowContainer/useGetPopupContainer.ts'

export interface BlockQuickPickPanelProps {
  readonly catalog?: FlowCanvasViewProps['addItemsCatalog']
  readonly hideDescription?: boolean
  readonly items: readonly FlowCanvasViewAddItem[]
  readonly connectionSide?: 'left' | 'right'
  readonly onClick?: (item: FlowCanvasViewAddItem, id: string) => void
  readonly provideAsyncItems?: (searchTerm: string, signal: AbortSignal) => Promise<readonly FlowCanvasViewAddItem[] | undefined>
}

export const BlockQuickPickPanel: React.FC<BlockQuickPickPanelProps> = (props) => {
  const t = useTranslate()
  const ref = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [openSubmenu, setOpenSubmenu] = useState(-1)
  const items = useMemo(() => nodePickerItems(props.items, props.connectionSide), [props.items, props.connectionSide])
  const provideAsyncItems = useMemo(() => {
    const provider = props.provideAsyncItems
    if (!provider) return
    return async (search: string, signal: AbortSignal) => {
      const result = await provider(search, signal)
      return result == null ? undefined : nodePickerItems(result, props.connectionSide)
    }
  }, [props.provideAsyncItems, props.connectionSide, props.catalog?.revision])
  const { error: asyncError, items: filteredItems, loading, retry } = useCollectionItems(items, searchTerm, provideAsyncItems)

  useEffect(() => {
    setCursorIndex((c) => clampCursorIndex(c, 1, filteredItems))
  }, [filteredItems])

  useEffect(() => {
    setOpenSubmenu(-1)
  }, [cursorIndex])

  const onNavigate = useCallback(
    (_input: HTMLInputElement, direction: -1 | 1) =>
      setCursorIndex((index) => {
        index += direction
        if (index < 0) {
          index += filteredItems.length
        }
        return clampCursorIndex(index, direction, filteredItems)
      }),
    [filteredItems],
  )

  const onReturn = useCallback(
    (_input: HTMLInputElement) => {
      const item = filteredItems[cursorIndex]
      if (item && item.type !== 'divider' && !item.disabled) {
        if (item.choices?.length) {
          setOpenSubmenu(cursorIndex)
        } else {
          props.onClick?.(item, item.id)
        }
      }
    },
    [cursorIndex, filteredItems, props.onClick],
  )

  // Restore input focus after the Dropdown auto-focuses its menu.
  const onMenuClose = useCallback(() => {
    setTimeout(() => {
      if (document.activeElement === document.body) {
        ref.current?.focus()
      }
    }, 50)
  }, [])

  return (
    <div className={clsx(styles.container, props.hideDescription && styles.hideDescription, 'open-flow-canvas-quick-pick-panel')}>
      <Input
        ref={ref}
        className={styles.search}
        placeholder={t('contextMenu.search')}
        prefix={
          <span className={styles.searchIcon}>
            <i className="i-codicon:search" />
          </span>
        }
        value={searchTerm}
        onChange={(s) => setSearchTerm(s)}
        autoFocus
        onNavigate={onNavigate}
        returnToCommit={onReturn}
      />
      <ScrollArea className={`${styles.list} nowheel`} tabIndex={-1} onClick={() => ref.current?.focus()}>
        {filteredItems.map((item, index) => (
          <BlockQuickPickPanelItem
            key={item.index}
            item={item}
            selected={index === cursorIndex}
            menuOpen={index === openSubmenu}
            hideDescription={props.hideDescription}
            onClick={(id) => item.type !== 'divider' && props.onClick?.(item, id)}
            onMenuClose={onMenuClose}
          />
        ))}
        {loading && (
          <div className={styles.loading} role="status">
            <i className="i-codicon:loading open-flow-canvas-spin" />
          </div>
        )}
        {!loading && (asyncError || props.catalog?.failed) && (
          <div className={styles.feedback} role="alert">
            <span>{t(props.catalog?.failed && !asyncError ? 'contextMenu.catalogRefreshFailed' : 'contextMenu.loadFailed')}</span>
            <Button
              onClick={() => {
                props.catalog?.refresh()
                retry()
              }}
              size="sm"
              variant="outline"
            >
              {t('contextMenu.retry')}
            </Button>
          </div>
        )}
        {!loading && !asyncError && filteredItems.length == 0 && <div className={styles.feedback}>{t('contextMenu.empty')}</div>}
      </ScrollArea>
    </div>
  )
}

export const BlockPickerRow = forwardRef<
  HTMLDivElement,
  {
    readonly disabled?: boolean
    readonly draggable?: boolean
    readonly hideDescription?: boolean
    readonly item: NodePickerItem
    readonly onClick?: MouseEventHandler<HTMLDivElement>
    readonly onDragStart?: DragEventHandler<HTMLDivElement>
    readonly selected?: boolean
    readonly trailing?: ReactNode
  }
>(function BlockPickerRow({ disabled, draggable, hideDescription, item, onClick, onDragStart, selected, trailing }, ref) {
  return item.type == 'divider' ? (
    <div className={clsx(styles.item, styles.dividerItem, 'open-flow-canvas-picker-divider')} ref={ref}>
      <span className={styles.divider}>{item.label}</span>
    </div>
  ) : (
    <div
      className={clsx(
        styles.item,
        'open-flow-canvas-picker-item',
        selected && !disabled && styles.selected,
        disabled && styles.disabled,
        hideDescription && styles.hideDescription,
      )}
      draggable={draggable}
      onClick={onClick}
      onDragStart={onDragStart}
      ref={ref}
      title={getItemTitle(item)}
    >
      <span className={clsx(styles.iconSlot, 'open-flow-canvas-picker-icon')}>
        <ContentIcon
          src={item.icon || getDefaultIcon(item)}
          className={styles.icon}
          fallback={<ContentIcon src={getDefaultIcon(item)} className={styles.icon} />}
        />
      </span>
      <span className={clsx(styles.label, 'open-flow-canvas-picker-label')}>{item.label}</span>
      {item.description && <span className={clsx(styles.description, 'open-flow-canvas-picker-description')}>{item.description}</span>}
      {trailing}
    </div>
  )
})

interface BlockQuickPickPanelItemProps {
  readonly item: NodePickerItem
  readonly selected?: boolean
  readonly menuOpen?: boolean
  readonly hideDescription?: boolean
  readonly onClick?: (id: string) => void
  readonly onMenuClose?: () => void
}

function BlockQuickPickPanelItem(props: BlockQuickPickPanelItemProps) {
  const getContextMenuContainer = useGetStaticPopupContainer()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const hasMenu = props.item.type !== 'divider' && !!props.item.choices?.length

  useEffect(() => {
    if (props.selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [props.selected])

  useEffect(() => setOpen(!!props.menuOpen), [props.menuOpen])

  if (props.item.type === 'divider') return <BlockPickerRow item={props.item} />

  const row = (
    <BlockPickerRow
      disabled={props.item.disabled}
      draggable={props.item.type === 'trigger' && !props.item.disabled}
      hideDescription={props.hideDescription}
      item={props.item}
      onClick={toTrue(!hasMenu && !props.item.disabled) && (() => props.item.type !== 'divider' && props.onClick?.(props.item.id))}
      onDragStart={(event) => {
        if (props.item.type === 'trigger' && props.item.id) setTriggerType(event.dataTransfer, props.item.id)
      }}
      ref={ref}
      selected={props.selected}
      trailing={hasMenu && <i className="i-codicon:chevron-right" />}
    />
  )

  if (!hasMenu || props.item.disabled) return row

  const container = getContextMenuContainer()
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) props.onMenuClose?.()
      }}
    >
      <DropdownMenuTrigger nativeButton={false} render={row} />
      <DropdownMenuContent
        align="start"
        className={clsx(styles.menu, props.hideDescription && !props.item.choices?.length && styles.hideDescription)}
        container={container}
        side="right"
        sideOffset={0}
      >
        <DropdownMenuGroup>
          {props.item.choices?.map((choice) => (
            <DropdownMenuItem key={choice.id} onClick={() => props.onClick?.(choice.id)}>
              <div className={styles.handle} title={choice.description == null ? choice.label : `${choice.label}\n${choice.description}`}>
                <span className={styles.handleName}>{choice.label}</span>
                {choice.description && <span className={styles.handleDescription}>{choice.description}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getItemTitle(item: NodePickerItem) {
  let title = item.label
  if (item.type !== 'divider' && item.description) {
    title += `\n${item.description}`
  }
  return title
}

function getDefaultIcon(item: NodePickerItem) {
  const fallback = (item.type === 'trigger' ? defaultTriggerIcon : defaultNodeIcon).replace('i-', ':') + ':'

  if (item.type === 'scriptlet') {
    switch (item.id.toLowerCase()) {
      case 'typescript':
        return ':carbon:script:'
      case 'javascript':
        return ':carbon:code:'
      default:
        return fallback
    }
  }

  return fallback
}

function clampCursorIndex(index: number, direction: -1 | 1, filteredItems: readonly NodePickerItem[]) {
  if (filteredItems.length == 0) return 0
  index = ((index % filteredItems.length) + filteredItems.length) % filteredItems.length
  const start = index
  do {
    const item = filteredItems[index]
    if (item.type !== 'divider' && !item.disabled) break
    index = (index + direction + filteredItems.length) % filteredItems.length
  } while (index != start)
  return index
}
