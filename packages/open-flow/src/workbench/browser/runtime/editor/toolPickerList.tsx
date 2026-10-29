import styles from '../../../../ui/browser/navigation-page.module.scss'
import type { ReactNode } from 'react'
import type { CustomItemComponentProps, VirtualizerHandle } from 'virtua'

import { createContext, forwardRef, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Virtualizer } from 'virtua'
import { Button } from '../../../../ui/browser/button.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { PickerGroupHeading } from './pickerGroupHeading.tsx'
import { ToolPickerItem } from './toolPickerItem.tsx'

export interface ToolPickerOption<T> {
  readonly id: string
  readonly value: T
  readonly name: string
  readonly icon: ReactNode
  readonly kind: 'navigation' | 'selection'
  readonly checked?: boolean
  readonly subtitle?: string
  readonly description?: string
}

export interface ToolPickerGroup<T> {
  readonly id: string
  readonly title: string
  readonly icon?: ReactNode
  readonly help?: string
  readonly items: readonly ToolPickerOption<T>[]
  readonly empty?: string
}

type PickerRow<T> =
  | { readonly kind: 'heading'; readonly group: ToolPickerGroup<T> }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'option'; readonly option: ToolPickerOption<T> }

// Keep the active group mounted while the virtualizer recycles the surrounding rows.
const StickyHeadingContext = createContext(-1)
const PickerVirtualItem = forwardRef<HTMLDivElement, CustomItemComponentProps>(({ children, style, index }, ref) => {
  const activeHeading = useContext(StickyHeadingContext)
  return (
    <div ref={ref} style={index == activeHeading ? { ...style, position: 'sticky', top: 0, zIndex: 1 } : style}>
      {children}
    </div>
  )
})

/** Shared selection surface; callers own catalog fetching, grouping and selection state. */
export function ToolPickerList<T>({
  groups,
  query,
  onQueryChange,
  searchLabel,
  loading,
  error,
  empty,
  onRetry,
  disabled,
  onChoose,
  portalRoot,
  parent,
  navigation,
  initialScrollTop = 0,
}: {
  readonly groups: readonly ToolPickerGroup<T>[]
  readonly query: string
  readonly onQueryChange: (value: string) => void
  readonly searchLabel: string
  readonly loading: boolean
  readonly error?: string
  readonly empty?: string
  readonly onRetry: () => void
  readonly disabled: boolean
  readonly onChoose: (value: T, scrollTop: number) => void
  readonly portalRoot?: HTMLElement | null
  readonly parent?: { readonly name: string; readonly onBack: (scrollTop: number) => void }
  readonly navigation?: 'forward' | 'back'
  readonly initialScrollTop?: number
}) {
  const t = useTranslate()
  const hasGroupIcons = groups.some((group) => group.icon != null)
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const virtualizer = useRef<VirtualizerHandle>(null)
  const [visibleIndex, setVisibleIndex] = useState(0)
  const restored = useRef(false)
  useEffect(() => {
    search.current?.focus()
  }, [])
  const rows = useMemo<PickerRow<T>[]>(
    () =>
      groups.flatMap((group) => [
        { kind: 'heading', group } as const,
        ...(group.items.length == 0 && group.empty ? [{ kind: 'empty', message: group.empty } as const] : []),
        ...group.items.map((option) => ({ kind: 'option', option }) as const),
      ]),
    [groups],
  )
  const headingIndexes = useMemo(() => rows.flatMap((item, index) => (item.kind == 'heading' ? [index] : [])), [rows])
  const activeHeading = headingIndexes.findLast((index) => index <= visibleIndex) ?? -1
  const scrollToGroup = (index: number) => {
    virtualizer.current?.scrollToIndex(index, {
      align: 'start',
      smooth: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
  }
  useLayoutEffect(() => {
    virtualizer.current?.scrollTo(0)
    setVisibleIndex(0)
  }, [query])
  useLayoutEffect(() => {
    if (viewport == null || rows.length == 0 || restored.current) return
    restored.current = true
    const offset = query == '' ? initialScrollTop : 0
    virtualizer.current?.scrollTo(offset)
    viewport.scrollTop = offset
  }, [viewport, initialScrollTop, rows.length, query])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2 px-4">
        <InputGroup className="[--ui-control-radius:8px]">
          <InputGroupAddon>
            <i aria-hidden="true" className="i-lucide-light:search size-4" />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            className="text-[13px]"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </InputGroup>
      </div>
      <div className={`${styles.page} gap-3`} data-navigation={navigation}>
        {parent != null && (
          <div className="mx-4 grid h-8 shrink-0 grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--ui-foreground)_4%,var(--ui-popover))] px-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('actionPicker.back')}
                    onClick={() => parent.onBack(viewport?.scrollTop ?? 0)}
                  >
                    <i aria-hidden="true" className="i-lucide-light:chevron-left size-4" />
                  </Button>
                }
              />
              <TooltipContent container={portalRoot}>{t('actionPicker.back')}</TooltipContent>
            </Tooltip>
            <span className="min-w-0 truncate text-center text-[13px] font-semibold" title={parent.name}>
              {parent.name}
            </span>
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1" defer={false} events={{ initialized: (instance) => setViewport(instance.elements().viewport) }}>
          <div className="flex flex-col gap-1 px-4">
            {loading && (
              <div role="status" className="flex items-center gap-2 px-2 py-3 text-muted-foreground">
                <Spinner />
                {t('contextPanel.loading')}
              </div>
            )}
            {error != null && (
              <div role="alert" className="flex items-center justify-between gap-2 px-2 py-3 text-muted-foreground">
                {error}
                <Button type="button" size="sm" variant="ghost" className="text-[13px] font-normal" onClick={onRetry}>
                  {t('contextPanel.retry')}
                </Button>
              </div>
            )}
            {empty && <p className="m-0 px-2 py-3 text-muted-foreground">{empty}</p>}
          </div>
          {viewport != null && (
            <StickyHeadingContext.Provider value={activeHeading}>
              <Virtualizer
                ref={virtualizer}
                item={PickerVirtualItem}
                keepMounted={activeHeading < 0 ? [] : [activeHeading]}
                data={rows}
                itemSize={groups.some((group) => group.items.some((item) => item.description || item.subtitle)) ? 76 : 44}
                scrollRef={{ current: viewport }}
                onScroll={(offset) => setVisibleIndex(virtualizer.current?.findItemIndex(offset) ?? 0)}
              >
                {(row, index) => (
                  <div className={`bg-popover px-4 pb-1 ${hasGroupIcons ? 'grid grid-cols-[14px_minmax(0,1fr)]' : ''}`}>
                    {hasGroupIcons && <div className="flex items-center justify-end pt-2 pb-1">{row.kind == 'heading' && row.group.icon}</div>}
                    {row.kind == 'heading' ? (
                      <PickerGroupHeading title={row.group.title} help={row.group.help} container={portalRoot} onClick={() => scrollToGroup(index)} />
                    ) : row.kind == 'empty' ? (
                      <p className="m-0 px-2.5 py-1 text-xs leading-5 text-muted-foreground">{row.message}</p>
                    ) : row.option.kind == 'navigation' ? (
                      <Button
                        key={row.option.id}
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="group/app h-auto min-w-0 w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-normal hover:bg-accent focus-visible:bg-accent"
                        onClick={() => onChoose(row.option.value, viewport.scrollTop)}
                      >
                        {row.option.icon}
                        <span className="min-w-0 flex-1 truncate text-left">{row.option.name}</span>
                        <i aria-hidden="true" className="i-lucide-light:chevron-right size-4 text-muted-foreground" />
                      </Button>
                    ) : (
                      <ToolPickerItem
                        key={row.option.id}
                        icon={row.option.icon}
                        name={row.option.name}
                        subtitle={row.option.subtitle}
                        description={row.option.description}
                        checked={row.option.checked ?? false}
                        disabled={disabled}
                        onToggle={() => onChoose(row.option.value, viewport.scrollTop)}
                      />
                    )}
                  </div>
                )}
              </Virtualizer>
            </StickyHeadingContext.Provider>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
