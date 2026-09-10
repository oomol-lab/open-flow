import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createI18n } from '../../src/canvas/browser/i18n/i18n-loader.ts'
import { defaultUiLanguage, uiLanguageNames, uiLanguages } from '../../src/localization/common/languages.ts'
import { Button } from '../../src/ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../../src/ui/browser/dropdown-menu.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../../src/ui/browser/tooltip.tsx'
import { StoryActions, StoryActionsProvider } from './storyActions.tsx'
import { labStories } from './storyCatalog.tsx'
import { StoryStage } from './storyStage.tsx'

type ThemeMode = 'system' | 'light' | 'dark'
const themeOptions = [
  { value: 'system', label: 'Follow system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

// Directory icons belong to navigation metadata, not individual stories.
const storyGroupIcons: Readonly<Record<string, `i-${string}`>> = {
  'Node Value': 'i-lucide:variable',
  'Node Condition': 'i-carbon:flow',
  'Canvas': 'i-carbon:template',
  'Theme Preview': 'i-carbon:color-palette',
  'Workbench': 'i-carbon:settings-adjust',
  'Controls': 'i-carbon:settings',
  'Popup': 'i-carbon:overflow-menu-horizontal',
  'Trigger Manual': 'i-carbon:play',
  'Trigger Schedule': 'i-carbon:event-schedule',
  'Trigger Webhook': 'i-carbon:webhook',
}

const storyGroups = [...new Set(labStories.map((entry) => entry.group))].map((name) => ({
  name,
  icon: storyGroupIcons[name] ?? (name.startsWith('Trigger ') ? 'i-carbon:flash' : undefined),
  entries: labStories.filter((entry) => entry.group === name),
}))

const storySections = [
  {
    name: 'Components',
    groups: storyGroups.filter((group) => !/^(?:Trigger|Node) /.test(group.name)),
  },
  {
    name: 'Nodes',
    groups: storyGroups.filter((group) => group.name.startsWith('Node ')),
  },
  {
    name: 'Triggers',
    groups: storyGroups.filter((group) => group.name.startsWith('Trigger ')),
  },
]

function StoryGroup({
  icon = 'i-carbon:folder',
  name,
  entries,
  selected,
  onSelect,
  search,
}: {
  readonly icon?: `i-${string}`
  readonly name: string
  readonly entries: readonly FrontendStory[]
  readonly selected: FrontendStory
  readonly onSelect: (story: FrontendStory) => void
  readonly search: string
}) {
  const active = selected.group === name
  const label = name.replace(/^(?:Trigger|Node) /, '')
  const [open, setOpen] = useState(active || Boolean(search))
  const id = useId()
  const currentLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) setOpen(true)
  }, [active, selected.id])
  useEffect(() => {
    if (search) setOpen(true)
  }, [search])
  useEffect(() => {
    if (!active || !open) return
    const frame = requestAnimationFrame(() => currentLink.current?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [active, open, selected.id])
  return (
    <details className="lab-nav-group" data-active={active || undefined} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-controls={id}>
        <span className="lab-nav-chevron" aria-hidden="true" />
        <i aria-hidden="true" className={`lab-nav-icon ${icon}`} />
        <span className="lab-nav-group-name" title={label}>
          {label}
        </span>
        <span className="lab-nav-count" aria-hidden="true">
          {entries.length}
        </span>
      </summary>
      <div className="lab-nav-items" id={id}>
        {entries.map((entry) => (
          <a
            aria-current={entry.id === selected.id ? 'page' : undefined}
            href={`?story=${encodeURIComponent(entry.id)}`}
            key={entry.id}
            ref={entry.id === selected.id ? currentLink : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              onSelect(entry)
            }}
          >
            <span>{entry.title === 'Sidebar display & edit' ? 'Sidebar' : entry.title}</span>
          </a>
        ))}
      </div>
    </details>
  )
}

function storyFromUrl() {
  const id = new URLSearchParams(location.search).get('story')
  return labStories.find((story) => story.id === id) ?? labStories.find((story) => story.id === 'canvas-cards') ?? labStories[0]!
}

export function FrontendLab() {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const visibleSections = storySections
    .map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => `${section.name} ${group.name} ${entry.title} ${entry.id}`.toLowerCase().includes(query)),
        }))
        .filter((group) => group.entries.length > 0),
    }))
    .filter((section) => section.groups.length > 0)
  const [storyId, setStoryId] = useState(() => storyFromUrl().id)
  const story = labStories.find((entry) => entry.id === storyId) ?? storyFromUrl()
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [language, setLanguage] = useState<UiLanguage>(defaultUiLanguage)
  const [status, setStatus] = useState('Ready')
  const dark = theme === 'system' ? systemDark : theme === 'dark'
  const i18n = useMemo(() => createI18n(language), [language])
  const currentSection = storySections.find((section) => section.groups.some((group) => group.name === story.group))!
  const path = [currentSection.name, story.group.replace(/^(?:Node|Trigger) /, ''), story.title]

  useLayoutEffect(() => {
    // The document owns the Lab theme, including shared menus portaled to body.
    document.body.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.lang = language
  }, [dark, language])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const update = () => setStoryId(storyFromUrl().id)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const selectStory = (next: FrontendStory) => {
    setStoryId(next.id)
    setStatus('Ready')
    const url = new URL(location.href)
    url.searchParams.set('story', next.id)
    history.replaceState(null, '', url)
  }
  const log: LogAction = (name, value) => {
    let detail = ''
    if (value !== undefined) {
      try {
        detail = JSON.stringify(value)
      } catch {
        detail = String(value)
      }
    }
    setStatus(detail ? `${name} ${detail}` : name)
  }

  return (
    <div className="lab-shell">
      <header className="lab-header">
        <h1 className="lab-brand">
          Open Flow <span>Lab</span>
        </h1>
        <nav className="lab-path" aria-label="Breadcrumb" title={path.join(' / ')}>
          <ol>
            {path.map((label, index) => (
              <li key={index} aria-current={index === path.length - 1 ? 'page' : undefined}>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </nav>
        <LabPreferences theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} />
      </header>
      <aside className="lab-sidebar">
        <div className="lab-search">
          <Input
            type="search"
            aria-label="Search stories"
            placeholder="Search stories…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('')
            }}
          />
        </div>
        <nav className="lab-navigation" aria-label="Stories">
          {visibleSections.length === 0 && (
            <p className="lab-search-empty" role="status">
              No stories found.
            </p>
          )}
          {visibleSections.map((section) => (
            <div key={section.name} className="lab-nav-section">
              <div className="lab-nav-section-label">{section.name}</div>
              {section.groups.map((group) => (
                <StoryGroup key={group.name} {...group} selected={story} onSelect={selectStory} search={query} />
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <StoryActionsProvider key={story.id}>
        <main className="lab-content" aria-label={story.title}>
          <header className="lab-story-header">
            {story.description && <StoryDescription text={story.description} />}
            <StoryActions />
          </header>
          <div className="lab-story-body">
            {story.standalone ? (
              <div className="standalone-stage" key={story.id}>
                {story.render(log, dark, language)}
              </div>
            ) : (
              <StoryStage dark={dark} i18n={i18n} key={story.id}>
                {story.render(log, dark, language)}
              </StoryStage>
            )}
          </div>
          <footer className="lab-status" role="status" title={status}>
            {status}
          </footer>
        </main>
      </StoryActionsProvider>
    </div>
  )
}

function LabPreferences({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  language: UiLanguage
  onLanguageChange: (language: UiLanguage) => void
}) {
  const currentTheme = themeOptions.find((option) => option.value === theme)!
  const ThemeIcon = currentTheme.icon
  return (
    <div className="lab-preferences">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Theme: ${currentTheme.label}`}
          title={`Theme: ${currentTheme.label}`}
        >
          <ThemeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onThemeChange(value as ThemeMode)}>
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} aria-label={`Language: ${uiLanguageNames[language]}`}>
          {uiLanguageNames[language]}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuRadioGroup value={language} onValueChange={(value) => onLanguageChange(value as UiLanguage)}>
            {uiLanguages.map((value) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                {uiLanguageNames[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function StoryDescription({ text }: { readonly text: string }) {
  const element = useRef<HTMLButtonElement>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text])
  return (
    <TooltipProvider delay={400}>
      <Tooltip disabled={!truncated}>
        <TooltipTrigger ref={element} className="lab-story-description" tabIndex={truncated ? 0 : -1} aria-label={text}>
          {text}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-lg whitespace-normal break-words">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
