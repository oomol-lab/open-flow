import styles from './IconPicker.module.scss'
import type { IconifyJSON } from '@iconify/types'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { GeneralIconifyData } from '../iconifyContext.tsx'

import { getIconData, iconToSVG, replaceIDs } from '@iconify/utils'
import { clsx } from 'clsx'
import { AsyncFzf } from 'fzf'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useI18n } from 'val-i18n-react'
import { Virtualizer } from 'virtua'
import { resolveUiLanguage } from '../../../../localization/common/languages.ts'
import { Button } from '../../button.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../input-group.tsx'
import { ScrollArea } from '../../scroll-area.tsx'
import { Tabs, TabsList, TabsTrigger } from '../../tabs.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../tooltip.tsx'
import { useIconifyCollectionLoader, useIconifyData } from '../iconifyContext.tsx'
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
  /** Language when not used under `I18nProvider`. */
  locale?: string

  /** Emits when user selected one icon from the component. */
  onChange?: (collection: string, icon: string, color: string, shuffle: boolean) => void
  /** Emits when user pressed `esc` with focus inside icon picker. */
  onCancel?: () => void
}

const COLUMNS = 9
const ROWS = 10
const CONTAINER_STYLE = { width: 308, height: 360 }

// Used for searching.
const MAX_ITEMS_INIT = COLUMNS * ROWS * 2
const MAX_ITEMS_STEP = COLUMNS * ROWS

const COLORS = ['currentColor', '#CC3E44', '#E37933', '#CBCB41', '#8DC149', '#7494A3', '#519ABA', '#A074C4', '#F55385', '#6D8086']

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

const ICON_SIZE = 32
const BUFFER_SIZE = ICON_SIZE * ROWS
const ROW_STYLE = { height: ICON_SIZE }

interface PickerIconProps {
  iconSet: IconifyJSON
  name: string
  color?: string
}

const PickerIcon = ({ iconSet, name, color }: PickerIconProps) => {
  const svg = useMemo(() => {
    const icon = getIconData(iconSet, name)
    if (!icon) return null
    const result = iconToSVG(icon, { width: '1em', height: '1em' })
    return { body: replaceIDs(result.body), viewBox: result.attributes.viewBox }
  }, [iconSet, name])

  if (!svg) return null

  return (
    <svg
      aria-hidden="true"
      className={clsx(styles.icon, 'text-lg')}
      focusable="false"
      style={{ color }}
      viewBox={svg.viewBox}
      // The picker only renders trusted SVG bodies from bundled Iconify collections.
      dangerouslySetInnerHTML={{ __html: svg.body }}
    />
  )
}

function renderRow(index: number, row: Row, iconSet: IconifyJSON, color?: string): React.ReactElement {
  return (
    <div key={index} className={styles.row} style={ROW_STYLE}>
      {Array.isArray(row) ? (
        row.map((icon) => (
          <Button variant="ghost" size="icon-sm" aria-label={icon} data-icon={icon} title={icon} key={icon} type="button">
            <PickerIcon iconSet={iconSet} name={icon} color={color} />
          </Button>
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
  const iconSet = iconifyData?.[collection]?.icons

  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const rows = useMemo(() => computeRows(iconifyData, filteredIcons, categories, collection), [iconifyData, filteredIcons, categories, collection])

  return (
    <ScrollArea className={styles.panel} defer={false} events={{ initialized: (instance) => setViewport(instance.elements().viewport) }} onClick={onClick}>
      {viewport && iconSet && (
        <Virtualizer data={rows} itemSize={ICON_SIZE} bufferSize={BUFFER_SIZE} scrollRef={{ current: viewport }}>
          {(row, index) => renderRow(index, row, iconSet, color)}
        </Virtualizer>
      )}
    </ScrollArea>
  )
}

type IconPickerTab = 'twemoji' | 'carbon'

export const IconPicker = ({
  className,
  emoji,
  carbon = true,
  defaultTab = rememberLastTab || (emoji ? 'twemoji' : 'carbon'),
  defaultColor = rememberLastColor || COLORS[0],
  locale,
  onChange,
  onCancel,
}: IconPickerProps) => {
  if (!emoji && !carbon) {
    carbon = true
  }

  const i18n = useI18n(true)
  const language$ = locale || i18n?.lang$ || 'en'
  const t = getTranslate(useVal(language$))

  const root = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<IconPickerTab>(defaultTab)
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
      if (icon && onChange) {
        onChange(tab, icon, selectedColor, false)
      }
    },
    [tab, selectedColor, onChange],
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
    root.current?.focus()
  }, [])

  const children = (
    <div className={clsx(styles.container, className)} style={CONTAINER_STYLE} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className={styles.filter}>
        <InputGroup className="h-6">
          <InputGroupAddon>
            <i aria-hidden="true" className="i-lucide-light:search text-sm" />
          </InputGroupAddon>
          <InputGroupInput
            className="h-full py-0 text-[11px] md:text-[11px]"
            aria-label={t('filter')}
            autoComplete="off"
            type="search"
            placeholder={t('filter')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            autoFocus
          />
        </InputGroup>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('random')} onClick={onClickShuffle} type="button" />}>
            <i aria-hidden="true" className="i-lucide-light:shuffle text-sm" />
          </TooltipTrigger>
          <TooltipContent>{t('random')}</TooltipContent>
        </Tooltip>
      </div>
      <div className={styles.tabs}>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab((rememberLastTab = value as IconPickerTab))
            setColorsPanel(false)
          }}
          className="min-w-0 flex-1"
        >
          <TabsList variant="flat" className="w-full rounded-[6px] p-0.5 group-data-[orientation=horizontal]/tabs:h-6">
            {emoji && (
              <TabsTrigger className="text-[11px] group-data-[variant=flat]/tabs-list:rounded-[4px]" value="twemoji">
                {t('emoji')}
              </TabsTrigger>
            )}
            {carbon && (
              <TabsTrigger className="text-[11px] group-data-[variant=flat]/tabs-list:rounded-[4px]" value="carbon">
                {t('carbon')}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        {hasColors && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-xs" aria-expanded={colorsPanel} aria-label={t('color')} onClick={toggleColorsPanel} type="button" />}
            >
              <i aria-hidden="true" className="i-lucide-light:palette text-sm" style={{ color: selectedColor }} />
            </TooltipTrigger>
            <TooltipContent>{t('color')}</TooltipContent>
          </Tooltip>
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
        <Button variant="ghost" size="xs" className="mx-3 mb-2 shrink-0 text-[11px]" onClick={loadMore} type="button">
          {t('more')}
        </Button>
      )}
    </div>
  )

  return children
}
