import styles from './IconPicker.module.scss'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { GeneralIconifyData } from '../iconifyContext.tsx'
import type { IconifyIconProps } from '../IconifyIcon.tsx'

import { clsx } from 'clsx'
import { AsyncFzf } from 'fzf'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useVal } from 'use-value-enhancer'
import { useI18n } from 'val-i18n-react'
import { Virtualizer } from 'virtua'
import { resolveUiLanguage } from '../../../../localization/common/languages.ts'
import { IconifyProvider, useIconifyCollectionLoader, useIconifyData } from '../iconifyContext.tsx'
import { IconifyIcon } from '../IconifyIcon.tsx'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

type IconPickerLocale = Readonly<Record<string, string>>

const translations: Readonly<Record<UiLanguage, IconPickerLocale>> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja': ja,
  'ko': ko,
  'ru': ru,
  'fr': fr,
}

let rememberLastTab: IconPickerTab | undefined
let rememberLastColor: string | undefined

function getTranslate(lang: string) {
  const data = translations[resolveUiLanguage([lang])]
  return (key: string) => data[key] || translations.en[key] || key
}

export interface IconPickerProps {
  className?: string

  /** Enable the emoji panel. Default is `false`. */
  emoji?: boolean
  /** Enable the carbon panel. Default is `true`. */
  carbon?: boolean

  /** Sets the initial tab. Defaults to `twemoji` when emoji is enabled, otherwise `carbon`. */
  defaultTab?: IconPickerTab
  /** Sets the initial Carbon icon color. */
  defaultColor?: string
  /** Icon picker will be put at the bottom center of the anchor element. */
  anchor?: HTMLElement | null
  /** Default `"bottom"`. */
  placement?: 'bottom' | 'top'
  /** Where to mount the component, default to `document.body`. */
  popupContainer?: HTMLElement | null

  /** Language when not used under `I18nProvider`. */
  locale?: string

  /** Emits when user selected one icon from the component. */
  onChange?: (collection: string, icon: string, color: string, shuffle: boolean) => void
  /** Emits when user pressed `esc` with focus inside icon picker. */
  onCancel?: () => void
}

export interface IconPickerResult {
  readonly collection: string
  readonly icon: string
  readonly color: string
  readonly shuffle: boolean
}

const SIZE = 18
const MARGIN = 4
const PADDING = 4
const SPACING = 4
const COLUMNS = 9
const ROWS = 10

const WIDTH = MARGIN * 2 + (SIZE + PADDING * 2 + SPACING) * COLUMNS - SPACING
const HEIGHT = 336
const CONTAINER_STYLE = { width: WIDTH, height: HEIGHT }

// Used for searching.
const MAX_ITEMS_INIT = COLUMNS * ROWS * 2
const MAX_ITEMS_STEP = COLUMNS * ROWS

const COLORS = ['currentColor', '#CC3E44', '#E37933', '#CBCB41', '#8DC149', '#7494A3', '#519ABA', '#A074C4', '#F55385', '#6D8086']

interface IContainer {
  readonly clientWidth: number
  getBoundingClientRect(): DOMRect
}

interface IPosition {
  readonly top: number
  readonly left: number
}

function isSamePosition(a: IPosition | null, b: IPosition | null): boolean {
  if (!a || !b) return false
  return a.top === b.top && a.left === b.left
}

function computePosition(anchorRect: DOMRect | undefined, container: IContainer | undefined, placement?: 'bottom' | 'top'): IPosition {
  if (!anchorRect || !container) {
    return { top: 0, left: 0 }
  }

  const containerRect = container.getBoundingClientRect()
  const { width } = anchorRect
  const left = anchorRect.left - containerRect.left
  const top = anchorRect.top - containerRect.top
  const bottom = anchorRect.bottom - containerRect.top
  const { clientWidth } = container

  // Center the popup below the anchor
  let x = left + width / 2 - WIDTH / 2

  // Make sure x is within the container
  if (x < MARGIN) x = MARGIN
  if (x + WIDTH + MARGIN > clientWidth) x = clientWidth - WIDTH - MARGIN

  return placement === 'top' ? { top: top - MARGIN - HEIGHT, left: x } : { top: bottom + MARGIN, left: x }
}

interface IconPickerPanelProps {
  filteredIcons?: string[] | null
  collection: string
  color?: string
  /** If empty, it will not render section headers. */
  categories?: { [category: string]: string[] } | null

  onClick?: (event: React.MouseEvent) => void
}

// string = category, string[] = one row of icons
type Row = string | string[]

function computeRows(
  iconifyData: GeneralIconifyData | null,
  filteredIcons?: string[] | null,
  categories?: IconPickerPanelProps['categories'],
  collection?: string,
): Row[] {
  const rows: Row[] = []
  if (!iconifyData) return rows
  if (filteredIcons) {
    for (let i = 0; i < filteredIcons.length; i += COLUMNS) {
      rows.push(filteredIcons.slice(i, i + COLUMNS))
    }
  } else if (categories) {
    for (const category in categories) {
      rows.push(category)
      const icons = categories[category]
      for (let i = 0; i < icons.length; i += COLUMNS) {
        rows.push(icons.slice(i, i + COLUMNS))
      }
    }
  } else if (collection) {
    const data = (iconifyData as GeneralIconifyData)[collection]
    const icons = data?.icons.icons
    if (icons) {
      filteredIcons = Object.keys(icons)
      for (let i = 0; i < filteredIcons.length; i += COLUMNS) {
        rows.push(filteredIcons.slice(i, i + COLUMNS))
      }
    }
  }
  return rows
}

const ICON_SIZE = SIZE + PADDING * 2 + SPACING / 2
const ROW_STYLE = { height: ICON_SIZE }
const ICON_STYLE = { width: ICON_SIZE, height: ICON_SIZE }

const LazyIcon = (props: IconifyIconProps) => {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const t = requestIdleCallback(() => setShow(true))
    return () => cancelIdleCallback(t)
  }, [])

  return show ? <IconifyIcon {...props} /> : null
}

function renderRow(index: number, row: Row, collection: string, color?: string): React.ReactElement {
  return (
    <div key={index} className={styles.row} style={ROW_STYLE}>
      {Array.isArray(row) ? (
        row.map((icon) => (
          <button aria-label={icon} data-icon={icon} title={icon} key={icon} style={ICON_STYLE} type="button">
            <LazyIcon collection={collection} icon={icon} color={color} className={styles.icon} />
          </button>
        ))
      ) : (
        <div className={styles.subtitle}>{row}</div>
      )}
    </div>
  )
}

// This can be used to handle both font awesome and emoji icons.
const IconPickerIconsPanel = ({ filteredIcons, collection, color, categories, onClick }: IconPickerPanelProps) => {
  const iconifyData = useIconifyData(true)

  const rows = useMemo(() => computeRows(iconifyData, filteredIcons, categories, collection), [iconifyData, filteredIcons, categories, collection])

  return (
    <div
      className={styles.panel}
      style={
        {
          '--size': SIZE + 'px',
          '--padding': PADDING + 'px',
          '--gap': SPACING / 2 + 'px',
          'overflowX': 'clip',
          'overflowY': 'scroll',
          'contain': 'strict',
        } as any
      }
      onClick={onClick}
    >
      <Virtualizer data={rows} itemSize={ICON_SIZE}>
        {(row, index) => renderRow(index, row, collection, color)}
      </Virtualizer>
    </div>
  )
}

type IconPickerTab = 'twemoji' | 'carbon'

const IconPickerImpl = ({
  className,
  emoji,
  carbon = true,
  defaultTab = rememberLastTab || (emoji ? 'twemoji' : 'carbon'),
  defaultColor = rememberLastColor || COLORS[0],
  anchor,
  placement,
  popupContainer,
  locale,
  onChange,
  onCancel,
}: IconPickerProps) => {
  if (!emoji && !carbon) {
    carbon = true
  }
  const container = popupContainer || document.body

  const i18n = useI18n(true)
  const language$ = locale || i18n?.lang$ || 'en'
  const t = getTranslate(useVal(language$))

  const [tab, setTab] = useState<IconPickerTab>(defaultTab)
  const [position, setPosition] = useState<IPosition | null>(null)
  const [searchText, setSearchText] = useState('')
  const [maxItems, setMaxItems] = useState(MAX_ITEMS_INIT)
  const [filteredIcons, setIcons] = useState<string[] | null>(null)
  const [selectedColor, setColor] = useState(defaultColor)
  const [colorsPanel, setColorsPanel] = useState(false)
  const hasColors = tab === 'carbon'

  const iconifyData = useIconifyData(true)
  const loadCollection = useIconifyCollectionLoader()

  useEffect(() => {
    void loadCollection?.(tab).catch((error) => console.error(`Failed to load the ${tab} icon collection.`, error))
  }, [loadCollection, tab])

  const fzf = useMemo((): AsyncFzf<string[]> | null => {
    const collection = iconifyData?.[tab]
    if (collection)
      return new AsyncFzf(Object.keys(collection.icons.icons), {
        casing: 'case-insensitive',
        fuzzy: 'v1',
      })
    return null
  }, [iconifyData, tab])

  useLayoutEffect(() => {
    if (anchor && typeof window !== 'undefined') {
      let ticket = 0
      let isMounted = true
      const update = () => {
        if (isMounted) {
          ticket = window.setTimeout(update, 500)
          const p = computePosition(anchor.getBoundingClientRect(), container, placement)
          setPosition((old) => (isSamePosition(old, p) ? old : p))
        }
      }
      update()
      return () => {
        isMounted = false
        clearTimeout(ticket)
      }
    }
  }, [anchor, placement, container])

  const loadMore = useCallback(() => {
    setMaxItems((currentMaxItems) => currentMaxItems + MAX_ITEMS_STEP)
  }, [])

  const searchTimeout = useRef(0)
  useEffect(() => {
    clearTimeout(searchTimeout.current)
    if (searchText) {
      setIcons([])
      if (!fzf || !searchText) {
        return
      }
      let isMounted = true
      searchTimeout.current = window.setTimeout(async () => {
        const result = await fzf.find(searchText)
        if (isMounted) {
          setMaxItems(MAX_ITEMS_INIT)
          setIcons(result.map((i) => i.item))
        }
      }, 200)
      return () => {
        isMounted = false
      }
    } else {
      setIcons(null)
    }
  }, [fzf, searchText])

  const onClickTabs = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLButtonElement
    const selectedTab = target.dataset.tab as IconPickerTab
    if (selectedTab) {
      setTab((rememberLastTab = selectedTab))
      setColorsPanel(false)
    }
  }, [])

  const onClickClose = useCallback(() => {
    if (onCancel) {
      onCancel()
    }
  }, [onCancel])

  const onClickShuffle = useCallback(() => {
    const collection = iconifyData?.[tab]
    if (onChange && collection) {
      const keys = Object.keys(collection.icons.icons)
      const icon = keys[Math.floor(Math.random() * keys.length)]
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      onChange(tab, icon, color, true)
    }
  }, [tab, onChange])

  const toggleColorsPanel = useCallback(() => {
    setColorsPanel((e) => !e)
  }, [])

  const onClickColors = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLButtonElement
    const color = target.dataset.color
    if (color) {
      setColor((rememberLastColor = color))
    }
  }, [])

  const onClickIcon = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLButtonElement
      const icon = target.dataset.icon
      if (icon && anchor) {
        anchor.focus()
      }
      if (icon && onChange) {
        onChange(tab, icon, selectedColor, false)
      }
    },
    [anchor, tab, selectedColor, onChange],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && onCancel) {
        event.stopPropagation()
        onCancel()
      }
    },
    [onCancel],
  )

  useEffect(() => {
    document.querySelector<HTMLElement>('.' + styles.container)?.focus()
  }, [])

  const children = (
    <div
      className={clsx(styles.container, className)}
      style={
        {
          ...CONTAINER_STYLE,
          ...position,
        } as any
      }
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className={styles.tabs} onClick={onClickTabs}>
        {emoji && (
          <button aria-pressed={tab === 'twemoji'} data-tab="twemoji" className={clsx(styles.tab, tab === 'twemoji' && 'is-active')} type="button">
            {t('emoji')}
          </button>
        )}
        {carbon && (
          <button
            aria-pressed={tab === 'carbon'}
            data-tab="carbon"
            className={clsx(styles.tab, tab === 'carbon' && 'is-active')}
            title={t('carbon')}
            type="button"
          >
            {t('carbon')}
          </button>
        )}
        <button aria-label={t('close')} className={styles.close} onClick={onClickClose} type="button">
          <IconifyIcon collection="carbon" icon="close" />
        </button>
      </div>
      <div className={styles.filter}>
        <input
          aria-label={t('filter')}
          autoComplete="off"
          type="search"
          placeholder={t('filter')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          autoFocus
        />
        <button aria-label={t('random')} className={styles.shuffle} onClick={onClickShuffle} title={t('random')} type="button">
          <IconifyIcon collection="carbon" icon="shuffle" />
        </button>
        {hasColors && (
          <button aria-expanded={colorsPanel} aria-label={t('color')} className={styles['pick-colors']} onClick={toggleColorsPanel} type="button">
            <IconifyIcon collection="carbon" icon="color-palette" color={selectedColor} />
          </button>
        )}
        <div onClick={onClickColors} className={styles.colors} style={hasColors && colorsPanel ? {} : { display: 'none' }}>
          {COLORS.map((color) => (
            <button
              aria-label={`${t('color')}: ${color}`}
              aria-pressed={selectedColor === color}
              className={styles.color}
              key={color}
              data-color={color}
              style={{ backgroundColor: color }}
              type="button"
            />
          ))}
        </div>
      </div>
      {iconifyData?.[tab] ? (
        <IconPickerIconsPanel
          key={tab}
          filteredIcons={filteredIcons?.slice(0, maxItems)}
          collection={tab}
          categories={iconifyData?.[tab]?.metadata?.categories}
          color={selectedColor}
          onClick={onClickIcon}
        />
      ) : (
        <div className={styles.loading}>
          <i className="i-codicon:loading" />
          <span>{t('loading')}</span>
        </div>
      )}
      {filteredIcons && filteredIcons.length > maxItems && (
        <button className={styles.more} onClick={loadMore} type="button">
          {t('more')}
        </button>
      )}
    </div>
  )

  return anchor ? (position ? createPortal(<div className={styles.float}>{children}</div>, container) : null) : children
}

function block<T>(): [promise: Promise<T>, resolve: (value: T) => void] {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return [promise, resolve]
}

export interface IconPickerController {
  /** Get the wrapper element. */
  readonly dom: HTMLElement
  /** Close the icon picker anyway. */
  dispose(): void
}

function getPopupContainer() {
  return document.querySelector('.monaco-workbench') || document.body
}

function open(props_: Omit<IconPickerProps, `on${string}`>): Promise<IconPickerResult | undefined> & IconPickerController {
  const container = props_.popupContainer || getPopupContainer()

  const wrapper = document.createElement('div')
  wrapper.className = 'icon-picker-wrapper'
  wrapper.style.position = 'absolute'
  wrapper.style.inset = '0'
  wrapper.style.zIndex = '1000'
  container.appendChild(wrapper)

  const root = createRoot(wrapper)

  let isMounted = true
  const dispose = () => {
    if (isMounted) {
      wrapper.removeEventListener('click', onClickOutside)
      root.unmount()
      container.removeChild(wrapper)
      isMounted = false
    }
  }

  const [promise, resolve] = block<IconPickerResult | undefined>()

  const onChange: IconPickerProps['onChange'] = (collection, icon, color, shuffle) => {
    resolve({ collection, icon, color, shuffle })
    dispose()
  }

  const onCancel: IconPickerProps['onCancel'] = () => {
    resolve(undefined)
    dispose()
  }

  const props: IconPickerProps = {
    ...props_,
    popupContainer: wrapper,
    onChange,
    onCancel,
  }

  const onClickOutside = (event: MouseEvent): void => {
    if ((event.target as HTMLElement | null)?.className === styles.float) {
      onCancel()
    }
  }
  wrapper.addEventListener('click', onClickOutside)

  root.render(
    <IconifyProvider>
      <IconPickerImpl {...props} />
    </IconifyProvider>,
  )

  return Object.assign(promise, {
    dom: wrapper,
    dispose,
  })
}

/** Must be rendered under an IconifyProvider. */
export const IconPicker = /*#__PURE__*/ Object.assign(IconPickerImpl, {
  Icon: /*#__PURE__*/ memo(IconifyIcon),
  displayName: 'IconPicker',
  open,
})
