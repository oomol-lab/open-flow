import type { Node, NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { GetPopupContainerContext } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n } from '../../src/canvas/browser/i18n/i18n-loader.ts'
import { defaultUiLanguage, uiLanguageNames, uiLanguages } from '../../src/localization/common/languages.ts'
import { TooltipProvider } from '../../src/ui/browser/tooltip.tsx'
import { CodeEditor } from '../../src/workbench/browser/runtime/editor/codeEditor.tsx'
import { agentStory } from './agent.tsx'
import { cardStories } from './cards.tsx'
import { conditionEditorStory } from './conditionEditor.tsx'
import { formStory } from './form.tsx'
import { libraryStory } from './library.tsx'
import { llmStory } from './llm.tsx'
import { markdownStory } from './markdown.tsx'
import { metadataStory } from './metadata.tsx'
import { nodeInputStory } from './nodeInput.tsx'
import { nodeStories } from './nodeStories.tsx'
import { overviewStories } from './overview.tsx'
import { scheduleStory } from './schedule.tsx'
import { stories } from './stories.tsx'
import { triggerConfigStory } from './triggerConfig.tsx'
import { triggerStories } from './triggerStories.tsx'
import { additionalInputsStory, groupedInputsStory, outputPortsStory, valueNodeStory } from './valueNode.tsx'
import { variablesStory } from './variables.tsx'
import { webhookStory } from './webhook.tsx'
import { workflowStories } from './workflow.tsx'

type ThemeMode = 'dark' | 'light' | 'system'

interface ActionEntry {
  readonly message: string
}

interface StoryNodeData extends Record<string, unknown> {
  readonly content: ReactNode
}

type StoryNode = Node<StoryNodeData, 'story'>

const nodeTypes = { story: StoryNodeView }

const codeEditorTyping = `/**
 * @typedef {{
 *   value: string;
 * }} Inputs;
 * @typedef {{
 *   result: string;
 * }} Outputs;
 */
`

const codeEditorSource = `export default async function (inputs, context) {
  await context.reportProgress(20)
  const response = await context.fetch("https://example.com")
  const text = await response.text()
  return { result: inputs.value + text }
}
`

const codeEditorStory: FrontendStory = {
  group: 'Workbench',
  id: 'code-editor',
  render: (log, dark) => <CodeEditorStory dark={dark} log={log} />,
  standalone: true,
  title: 'Code Editor',
}

const labStories: readonly FrontendStory[] = [
  ...nodeStories,
  ...triggerStories,
  ...cardStories,
  ...workflowStories,
  ...stories,
  formStory,
  libraryStory,
  agentStory,
  llmStory,
  metadataStory,
  markdownStory,
  scheduleStory,
  triggerConfigStory,
  webhookStory,
  conditionEditorStory,
  variablesStory,
  nodeInputStory,
  valueNodeStory,
  additionalInputsStory,
  groupedInputsStory,
  outputPortsStory,
  codeEditorStory,
  ...overviewStories,
]

// Directory icons belong to navigation metadata, not individual stories.
const storyGroupIcons: Readonly<Record<string, `i-${string}`>> = {
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

function StoryGroup({
  icon,
  name,
  entries,
  selected,
  onSelect,
}: {
  readonly icon?: `i-${string}`
  readonly name: string
  readonly entries: readonly FrontendStory[]
  readonly selected: FrontendStory
  readonly onSelect: (story: FrontendStory) => void
}) {
  const active = selected.group === name
  const label = name.replace(/^(?:Trigger|Node) /, '')
  const [open, setOpen] = useState(active)
  const id = useId()
  const currentLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) setOpen(true)
  }, [active, selected.id])
  useEffect(() => {
    if (!active || !open) return
    const frame = requestAnimationFrame(() => currentLink.current?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [active, open, selected.id])
  return (
    <details className="lab-nav-group" data-active={active || undefined} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-controls={id}>
        <span className="lab-nav-chevron" aria-hidden="true" />
        {icon && <i aria-hidden="true" className={`lab-nav-icon ${icon}`} />}
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

function initialStory(): FrontendStory {
  const requested = new URLSearchParams(location.search).get('story')
  const story = labStories.find((item) => item.id == requested) ?? labStories.find((item) => item.id == 'canvas-cards') ?? labStories[0]
  if (!story) throw new Error('Open Flow Lab has no stories.')
  return story
}

export function FrontendLab() {
  const [storyId, setStoryId] = useState(() => initialStory().id)
  const story = labStories.find((entry) => entry.id == storyId) ?? initialStory()
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [language, setLanguage] = useState<UiLanguage>(defaultUiLanguage)
  const [action, setAction] = useState<ActionEntry | null>(null)
  const dark = theme == 'system' ? systemDark : theme == 'dark'
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  const log: LogAction = (name, value) => setAction({ message: `${name}${value === undefined ? '' : ` ${print(value)}`}` })
  const selectStory = (next: FrontendStory) => {
    setStoryId(next.id)
    const url = new URL(location.href)
    url.searchParams.set('story', next.id)
    history.replaceState(null, '', url)
  }

  return (
    <div className="lab-shell open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
      <aside className="lab-sidebar">
        <div className="lab-brand">
          <strong>Open Flow</strong>
          <span className="lab-brand-badge">Lab</span>
        </div>
        <nav className="lab-navigation" aria-label="Stories">
          <div className="lab-nav-section-label">Components</div>
          {storyGroups
            .filter((group) => !/^(?:Trigger|Node) /.test(group.name))
            .map((group) => (
              <StoryGroup key={group.name} {...group} selected={story} onSelect={selectStory} />
            ))}
          <div className="lab-nav-section-label">Nodes</div>
          {storyGroups
            .filter((group) => group.name.startsWith('Node '))
            .map((group) => (
              <StoryGroup key={group.name} {...group} selected={story} onSelect={selectStory} />
            ))}
          <div className="lab-nav-section-label">Triggers</div>
          {storyGroups
            .filter((group) => group.name.startsWith('Trigger '))
            .map((group) => (
              <StoryGroup key={group.name} {...group} selected={story} onSelect={selectStory} />
            ))}
        </nav>
      </aside>
      <main className="lab-main">
        <header className="lab-toolbar">
          <div className="lab-story-heading">
            <span title={story.group}>{story.group.replace(/^Node /, 'Nodes / ')}</span>
            <strong>{story.title}</strong>
          </div>
          <div aria-label="Theme" className="toolbar-segment toolbar-icons">
            <ToolbarButton active={theme == 'system'} label="System theme" onClick={() => setTheme('system')}>
              <Monitor />
            </ToolbarButton>
            <ToolbarButton active={theme == 'light'} label="Light theme" onClick={() => setTheme('light')}>
              <Sun />
            </ToolbarButton>
            <ToolbarButton active={theme == 'dark'} label="Dark theme" onClick={() => setTheme('dark')}>
              <Moon />
            </ToolbarButton>
          </div>
          <div className="toolbar-segment">
            <select aria-label="Language" onChange={(event) => setLanguage(event.target.value as UiLanguage)} value={language}>
              {uiLanguages.map((entry) => (
                <option key={entry} value={entry}>
                  {uiLanguageNames[entry]}
                </option>
              ))}
            </select>
          </div>
        </header>
        <div className="lab-workspace">
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
        <div className="lab-status" role="status">
          {action?.message ?? 'Ready'}
        </div>
      </main>
    </div>
  )
}

function CodeEditorStory({ dark, log }: { readonly dark: boolean; readonly log: LogAction }) {
  const [value, setValue] = useState(codeEditorSource)
  return (
    <div className="code-editor-story open-flow-workbench" data-theme={dark ? 'dark' : 'light'}>
      <CodeEditor
        ariaLabel="JavaScript source"
        disabled={false}
        errorLabel="Code editor unavailable"
        loadingLabel="Loading code editor"
        onBlur={() => log('code.blur', { length: value.length })}
        onChange={(source) => {
          setValue(source)
          log('code.change', { length: source.length })
        }}
        theme={dark ? 'dark' : 'light'}
        typing={codeEditorTyping}
        uri="file:///modules/designer-lab.js"
        value={value}
      />
    </div>
  )
}

function ToolbarButton({
  active,
  children,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly children: React.ReactNode
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button aria-label={label} aria-pressed={active} onClick={onClick} title={label} type="button">
      {children}
    </button>
  )
}

function StoryStage({ children, dark, i18n }: { readonly children: React.ReactNode; readonly dark: boolean; readonly i18n: ReturnType<typeof createI18n> }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLDivElement>(null)
  const getFlowPopupContainer = () => stageRef.current?.querySelector<HTMLElement>('.react-flow__viewport') || stageRef.current || document.body
  const getStaticPopupContainer = () => staticRef.current || document.body
  const context = useMemo(() => ({ default: getFlowPopupContainer, static: getStaticPopupContainer }), [])
  const nodes = useMemo<StoryNode[]>(
    () => [{ id: 'story', type: 'story', position: { x: 80, y: 60 }, data: { content: children }, draggable: false, selectable: true }],
    [children],
  )

  return (
    <div className="stage-frame" ref={stageRef}>
      <div className={`open-flow-canvas-root open-flow-theme stage-theme`} data-surface="canvas" data-theme={dark ? 'dark' : 'light'}>
        <div className="stage-static-root" ref={staticRef} />
        <GetPopupContainerContext.Provider value={context}>
          <I18nProvider i18n={i18n}>
            <TooltipProvider delay={250}>
              <ReactFlow
                colorMode={dark ? 'dark' : 'light'}
                edges={[]}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.12 }}
                maxZoom={3}
                minZoom={0.1}
                nodeTypes={nodeTypes}
                nodes={nodes}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </TooltipProvider>
          </I18nProvider>
        </GetPopupContainerContext.Provider>
      </div>
    </div>
  )
}

function StoryNodeView({ data }: NodeProps<StoryNode>) {
  return (
    <div className="story-node-outer">
      <main className="story-node-container">
        <div className="story-node-body nopan">{data.content}</div>
      </main>
    </div>
  )
}

function print(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
