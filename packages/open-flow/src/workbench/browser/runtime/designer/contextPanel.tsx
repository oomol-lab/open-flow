import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode, RefObject } from 'react'
import type { IAddNodeMenuItem } from '../../../../designer/browser/stores/designer/designer.store.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'
import type { AddNodeOption } from './addNodeOptions.ts'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { OverlayScrollbar } from '../../../../designer/browser/components/overlayScrollbar.tsx'
import { filterBlockPickerItems, useBlockPickerItems } from '../../../../designer/browser/graph/blockPicker.ts'
import { setAddItemId } from '../../../../designer/browser/graph/ReactFlowContainer/addItemDrag.ts'
import { DesignerIcon } from '../../../../designer/browser/icons/DesignerIcon.tsx'
import { ThemeProvider } from '../../../../designer/browser/theme/ThemeProvider.tsx'
import { Button, buttonVariants } from '../../../../ui/browser/button.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Separator } from '../../../../ui/browser/separator.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { indexAddNodeOptions } from './addNodeOptions.ts'
import { cycleContextPanelFocus, observeContextPanelOverlay } from './contextPanelBehavior.ts'

interface ContextPanelProps {
  readonly children: ReactNode
  readonly focusOnOpen: boolean
  readonly icon: IconName
  readonly onClose: () => void
  readonly theme: WorkbenchTheme
  readonly title: string
}

interface LibraryItemProps {
  readonly disabled: boolean
  readonly item: Exclude<IAddNodeMenuItem, { type: 'divider' }>
  readonly onAdd: (itemId: string) => void
  readonly onDrag: (event: ReactDragEvent, itemId: string) => void
  readonly onLoadChoices: (itemId: string, signal: AbortSignal) => Promise<readonly LibraryChoice[] | undefined>
}

type LibraryChoice = NonNullable<Exclude<IAddNodeMenuItem, { type: 'divider' }>['choices']>[number]

interface BlockLibraryProps {
  readonly browseOptions: (signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
  readonly disabled: boolean
  readonly focusRequest: number
  readonly onAdd: (option: AddNodeOption) => Promise<string | undefined>
  readonly onRegisterDragOption: (option: AddNodeOption) => void
  readonly options: readonly AddNodeOption[]
  readonly provideChoices: (optionId: string, signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
}

function useOverlayPanel(panel: RefObject<HTMLElement | null>): boolean {
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    const root = panel.current?.closest<HTMLElement>('.open-flow-workbench')
    if (root == null) return
    return observeContextPanelOverlay(root, setOverlay)
  }, [panel])

  return overlay
}

export function ContextPanel({ children, focusOnOpen, icon, onClose, theme, title }: ContextPanelProps): ReactElement {
  const t = useTranslate()
  const panel = useRef<HTMLElement>(null)
  const overlay = useOverlayPanel(panel)
  const titleId = useId()

  useEffect(() => {
    if (overlay && focusOnOpen) panel.current?.focus({ preventScroll: true })
  }, [focusOnOpen, overlay])

  useEffect(() => {
    if (!overlay) return
    const close = (event: KeyboardEvent): void => {
      const target = event.target
      if (event.key != 'Escape' || event.defaultPrevented || (target instanceof Element && target.closest('.oo-designer-quick-pick-panel') != null)) return
      event.preventDefault()
      onClose()
    }
    globalThis.addEventListener('keydown', close)
    return () => globalThis.removeEventListener('keydown', close)
  }, [onClose, overlay])

  const keyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key == 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (!overlay || event.key != 'Tab') return
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ]
    if (cycleContextPanelFocus(event.currentTarget, focusable, event.currentTarget.ownerDocument.activeElement, event.shiftKey)) event.preventDefault()
  }

  return (
    <ThemeProvider dark={theme == 'dark'}>
      <>
        <div aria-hidden="true" className="context-panel-backdrop" onClick={onClose} />
        <aside
          aria-labelledby={titleId}
          aria-modal={overlay || undefined}
          className="context-panel"
          data-theme={theme}
          onKeyDown={keyDown}
          ref={panel}
          role={overlay ? 'dialog' : 'complementary'}
          tabIndex={-1}
        >
          <header>
            <span className="node-icon small">
              <Icon name={icon} size={16} />
            </span>
            <strong id={titleId}>{title}</strong>
            <Button aria-label={t('contextPanel.close')} onClick={onClose} size="icon-sm" type="button" variant="ghost">
              <Icon name="close" />
            </Button>
          </header>
          <div className="context-panel-content">{children}</div>
        </aside>
      </>
    </ThemeProvider>
  )
}

function optionType(option: AddNodeOption): Exclude<IAddNodeMenuItem, { type: 'divider' }>['type'] {
  switch (option.kind) {
    case 'new-task':
    case 'subflow':
      return 'block'
    case 'connector-group':
      return 'connector'
    case 'comment':
    case 'condition':
    case 'connector':
    case 'llm':
    case 'trigger':
    case 'value':
      return option.kind
  }
}

function menuItems(options: readonly AddNodeOption[]): IAddNodeMenuItem[] {
  const items: IAddNodeMenuItem[] = []
  let group: string | undefined
  for (const option of options) {
    if (option.group != null && option.group != group) {
      group = option.group
      items.push({ label: group, type: 'divider' })
    }
    items.push({
      choices: option.choices?.map((choice) => ({
        data: choice.option.id,
        description: choice.description,
        label: choice.label,
      })),
      data: option.id,
      description: option.description,
      detail: option.description,
      icon: option.icon,
      label: option.label,
      type: optionType(option),
    })
  }
  return items
}

function fallbackIcon(item: Exclude<IAddNodeMenuItem, { type: 'divider' }>): IconName {
  switch (item.type) {
    case 'condition':
      return 'condition'
    case 'connector':
      return 'connection'
    case 'llm':
      return 'llm'
    case 'trigger':
      return 'trigger'
    case 'value':
      return 'value'
    case 'block':
    case 'comment':
    case 'scriptlet':
      return 'task'
  }
}

function LibraryRow({ item, trailing }: { readonly item: Exclude<IAddNodeMenuItem, { type: 'divider' }>; readonly trailing?: ReactNode }): ReactElement {
  const fallback = <Icon name={fallbackIcon(item)} />
  return (
    <span className="block-library-row" title={item.detail ?? item.description ?? item.label}>
      <span className="block-library-row-icon">
        <DesignerIcon className="block-library-row-glyph" fallback={fallback} src={item.icon} />
      </span>
      <span className="block-library-row-label">{item.label}</span>
      {item.description && <span className="block-library-row-description">{item.description}</span>}
      {trailing}
    </span>
  )
}

function LibraryGroup({ label }: { readonly label: string }): ReactElement {
  return (
    <div className="block-library-group">
      <span>{label}</span>
      <Separator />
    </div>
  )
}

function LibraryItem({ disabled, item, onAdd, onDrag, onLoadChoices }: LibraryItemProps): ReactElement {
  const t = useTranslate()
  const connectionChoices = item.type == 'trigger'
  const controller = useRef<AbortController>()
  const [choices, setChoices] = useState(item.choices)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(item.choices == null || item.choices.length > 0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    controller.current?.abort()
    setChoices(item.choices)
    setError(false)
    setLoaded(item.choices == null || item.choices.length > 0)
    setLoading(false)
    return () => controller.current?.abort()
  }, [item.choices, item.data])

  const load = useCallback((): void => {
    if (item.data == null || disabled || loading) return
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setError(false)
    setLoading(true)
    void onLoadChoices(item.data, nextController.signal)
      .then((nextChoices) => {
        if (nextController.signal.aborted || nextChoices == null) return
        setChoices(nextChoices)
        setLoaded(true)
      })
      .catch(() => {
        if (!nextController.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!nextController.signal.aborted) setLoading(false)
      })
  }, [disabled, item.data, loading, onLoadChoices])

  if (item.choices != null) {
    return (
      <details className="block-library-choices" onToggle={(event) => event.currentTarget.open && !loaded && load()}>
        <summary
          aria-disabled={disabled}
          className={cn(buttonVariants({ variant: 'ghost' }), 'block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2')}
          onClick={(event) => disabled && event.preventDefault()}
        >
          <LibraryRow
            item={item}
            trailing={
              <span className="block-library-expand">
                {loaded && (choices?.length ?? 0)}
                <Icon name="chevron-down" size={13} />
              </span>
            }
          />
        </summary>
        <div className="block-library-choice-list">
          {choices?.map((choice) => {
            const choiceItem = { ...item, choices: undefined, data: choice.data, description: choice.description, label: choice.label }
            return (
              <Button
                className="block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2"
                disabled={disabled}
                draggable={!disabled}
                key={choice.data}
                onClick={() => onAdd(choice.data)}
                onDragStart={(event) => onDrag(event, choice.data)}
                type="button"
                variant="ghost"
              >
                <LibraryRow item={choiceItem} />
              </Button>
            )
          })}
          {loading && (
            <div className="block-library-choice-feedback">{t(connectionChoices ? 'contextPanel.loadingConnections' : 'contextPanel.loadingActions')}</div>
          )}
          {!loading && error && (
            <div className="block-library-choice-feedback" role="alert">
              <span>{t(connectionChoices ? 'contextPanel.loadConnectionsFailed' : 'contextPanel.loadActionsFailed')}</span>
              <Button onClick={load} size="sm" type="button" variant="secondary">
                {t('contextPanel.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && loaded && choices?.length == 0 && (
            <div className="block-library-choice-feedback">{t(connectionChoices ? 'contextPanel.noConnections' : 'contextPanel.noActions')}</div>
          )}
        </div>
      </details>
    )
  }
  return (
    <Button
      className="block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2"
      disabled={disabled}
      draggable={!disabled}
      onClick={() => item.data != null && onAdd(item.data)}
      onDragStart={(event) => item.data != null && onDrag(event, item.data)}
      type="button"
      variant="ghost"
    >
      <LibraryRow item={item} />
    </Button>
  )
}

export function BlockLibrary({ browseOptions, disabled, focusRequest, onAdd, onRegisterDragOption, options, provideChoices }: BlockLibraryProps): ReactElement {
  const t = useTranslate()
  const search = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const dynamicOptions = useRef<ReadonlyMap<string, AddNodeOption>>(new Map())
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const staticOptions = useMemo(() => indexAddNodeOptions(options), [options])
  const localItems = useMemo(() => menuItems(options), [options])
  const provideAsyncItems = useCallback(
    async (_searchTerm: string, signal: AbortSignal): Promise<readonly IAddNodeMenuItem[] | undefined> => {
      const nextOptions = await browseOptions(signal)
      if (signal.aborted || nextOptions == null) return
      dynamicOptions.current = indexAddNodeOptions(nextOptions)
      return menuItems(nextOptions)
    },
    [browseOptions],
  )
  const loadChoices = useCallback(
    async (itemId: string, signal: AbortSignal): Promise<readonly LibraryChoice[] | undefined> => {
      const nextOptions = await provideChoices(itemId, signal)
      if (signal.aborted || nextOptions == null) return
      dynamicOptions.current = new Map([...dynamicOptions.current, ...indexAddNodeOptions(nextOptions)])
      return nextOptions.map((option) => ({ data: option.id, description: option.description, label: option.label }))
    },
    [provideChoices],
  )
  const { error, items: catalogItems, loading, retry } = useBlockPickerItems(localItems, '', provideAsyncItems)
  const items = useMemo(() => filterBlockPickerItems(query, catalogItems), [catalogItems, query])
  const busy = disabled || adding

  useEffect(() => {
    search.current?.focus({ preventScroll: true })
  }, [focusRequest])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const resolve = (itemId: string): AddNodeOption | undefined => staticOptions.get(itemId) ?? dynamicOptions.current.get(itemId)
  const add = async (itemId: string): Promise<void> => {
    const option = resolve(itemId)
    if (option == null || busy) return
    setAdding(true)
    try {
      await onAdd(option)
    } finally {
      if (active.current) setAdding(false)
    }
  }
  const drag = (event: ReactDragEvent, itemId: string): void => {
    const option = resolve(itemId)
    if (option == null || busy) return
    onRegisterDragOption(option)
    setAddItemId(event.dataTransfer, itemId)
  }

  return (
    <div aria-busy={adding || loading} className="block-library">
      <div className="mx-3.5 mb-2 mt-3 flex-none">
        <InputGroup>
          <span className="sr-only">{t('contextPanel.search')}</span>
          <InputGroupAddon>
            <Icon name="search" size={15} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('contextPanel.search')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('contextPanel.searchPlaceholder')}
            ref={search}
            value={query}
          />
        </InputGroup>
      </div>
      <OverlayScrollbar className="block-library-list" defer={false} tabIndex={-1}>
        <div className="block-library-list-content">
          {items.map((item) =>
            item.type == 'divider' ? (
              <LibraryGroup key={`group:${item.label}`} label={item.label} />
            ) : (
              <LibraryItem
                disabled={busy || item.disabled == true}
                item={item}
                key={item.data ?? item.label}
                onAdd={(id) => void add(id)}
                onDrag={drag}
                onLoadChoices={loadChoices}
              />
            ),
          )}
          {loading && (
            <div className="block-library-feedback" role="status">
              <Spinner data-icon="inline-start" />
              {t('contextPanel.loading')}
            </div>
          )}
          {!loading && error && (
            <div className="block-library-feedback" role="alert">
              <span>{t('contextPanel.loadFailed')}</span>
              <Button onClick={retry} size="sm" type="button" variant="secondary">
                {t('contextPanel.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && items.length == 0 && <div className="block-library-feedback">{t('contextPanel.empty')}</div>}
        </div>
      </OverlayScrollbar>
    </div>
  )
}
