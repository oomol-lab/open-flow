import type { Node, NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { Background, Controls, ReactFlow } from '@xyflow/react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { GetPopupContainerContext } from '../../src/designer/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n } from '../../src/designer/browser/i18n/i18n-loader.ts'
import { designerThemeClass } from '../../src/designer/browser/theme/designerThemeClass.ts'
import { ThemeProvider } from '../../src/designer/browser/theme/ThemeProvider.tsx'
import { defaultUiLanguage, uiLanguageNames, uiLanguages } from '../../src/localization/common/languages.ts'
import { TooltipProvider } from '../../src/ui/browser/tooltip.tsx'
import { CodeEditor } from '../../src/workbench/browser/runtime/designer/codeEditor.tsx'
import { stories } from './stories.tsx'

type ThemeMode = 'dark' | 'light' | 'system'

interface ActionEntry {
  readonly message: string
}

interface StoryNodeData extends Record<string, unknown> {
  readonly content: ReactNode
}

type StoryNode = Node<StoryNodeData, 'story'>

const nodeTypes = { story: StoryNodeView }

const codeEditorSource = `//#region generated meta
/**
 * @typedef {{
 *   value: string;
 * }} Inputs;
 * @typedef {{
 *   result: string;
 * }} Outputs;
 */
//#endregion

/**
 * @import { TaskContext } from "@oomol-lab/open-flow"
 * @param {Inputs} input
 * @param {TaskContext<Outputs>} context
 * @returns {Promise<Partial<Outputs> | undefined | void>}
 */
export default async function (input, context) {
  await context.reportProgress(20)
  const response = await context.fetch("https://example.com")
  const text = await response.text()
  return { result: input.value + text }
}
`

const codeEditorStory: DesignerStory = {
  group: 'Workbench',
  id: 'code-editor',
  render: (log, dark) => <CodeEditorStory dark={dark} log={log} />,
  standalone: true,
  title: 'Code Editor',
}

const labStories: readonly DesignerStory[] = [...stories, codeEditorStory]

function initialStory(): DesignerStory {
  const story = labStories.find((item) => item.id == new URLSearchParams(location.search).get('story')) ?? labStories[0]
  if (!story) throw new Error('Designer Lab has no stories.')
  return story
}

export function DesignerLab() {
  const [story, setStory] = useState(initialStory)
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
  const selectStory = (next: DesignerStory) => {
    setStory(next)
    const url = new URL(location.href)
    url.searchParams.set('story', next.id)
    history.replaceState(null, '', url)
  }

  return (
    <div className="lab-shell" data-theme={dark ? 'dark' : 'light'}>
      <aside className="lab-sidebar">
        <div className="lab-brand">
          <strong>Designer Lab</strong>
        </div>
        {[...new Set(labStories.map((entry) => entry.group))].map((group) => (
          <section key={group}>
            <h2>{group}</h2>
            {labStories
              .filter((entry) => entry.group == group)
              .map((entry) => (
                <button className={entry.id == story.id ? 'active' : ''} key={entry.id} onClick={() => selectStory(entry)}>
                  {entry.title}
                </button>
              ))}
          </section>
        ))}
      </aside>
      <main className="lab-main">
        <header className="lab-toolbar">
          <div>
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
            <div className="standalone-stage">{story.render(log, dark)}</div>
          ) : (
            <StoryStage dark={dark} i18n={i18n}>
              {story.render(log, dark)}
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
        onChange={(source) => {
          setValue(source)
          log('code.change', { length: source.length })
        }}
        theme={dark ? 'dark' : 'light'}
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
      <div className={`oo-designer-root ${designerThemeClass(dark)} stage-theme`} data-theme={dark ? 'dark' : 'light'}>
        <div className="stage-static-root" ref={staticRef} />
        <GetPopupContainerContext.Provider value={context}>
          <I18nProvider i18n={i18n}>
            <TooltipProvider delay={250}>
              <ThemeProvider dark={dark} getPopupContainer={getStaticPopupContainer}>
                <ReactFlow
                  colorMode={dark ? 'dark' : 'light'}
                  edges={[]}
                  maxZoom={3}
                  minZoom={0.1}
                  nodeTypes={nodeTypes}
                  nodes={nodes}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={20} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </ThemeProvider>
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
