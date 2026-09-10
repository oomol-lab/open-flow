import type { ReactNode } from 'react'
import type { DateFormat } from '../../src/form/common/dateValue.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'

import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { CanvasTooltip } from '../../src/canvas/browser/components/tooltip.tsx'
import { CanvasInteractiveMode, CanvasToolbar, CanvasViewControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CanvasControls.tsx'
import { CornerControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CornerControls.tsx'
import { GetPopupContainerContext, useGetStaticPopupContainer } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n as createDesignerI18n } from '../../src/canvas/browser/i18n/i18n-loader.ts'
import { DateEditor } from '../../src/form/browser/dateEditor.tsx'
import { Button } from '../../src/ui/browser/button.tsx'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '../../src/ui/browser/context-menu.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../src/ui/browser/dropdown-menu.tsx'
import { Field as UiField, FieldLabel } from '../../src/ui/browser/field.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../src/ui/browser/popover.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../src/ui/browser/select.tsx'
import { Textarea } from '../../src/ui/browser/textarea.tsx'
import { WorkbenchCanvasActions, WorkbenchInspectorToggle } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { createI18n as createWorkbenchI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'

export type LogAction = (name: string, value?: unknown) => void

export interface FrontendStory {
  readonly group: string
  readonly id: string
  readonly render: (log: LogAction, dark: boolean, language: UiLanguage) => ReactNode
  readonly standalone?: boolean
  readonly title: string
  readonly description?: string
}

const basicOptions = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Disabled option', value: 'disabled', disabled: true },
]

function SelectOptions({ grouped = false }: { grouped?: boolean }) {
  return (
    <>
      <SelectGroup>
        {grouped && <SelectLabel>Primitive</SelectLabel>}
        {basicOptions.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectGroup>
      {grouped && (
        <SelectGroup>
          <SelectLabel>Structured</SelectLabel>
          <SelectItem value="object">Object</SelectItem>
          <SelectItem value="array">Array with an intentionally long label</SelectItem>
        </SelectGroup>
      )}
    </>
  )
}

function SelectStory({ log }: { readonly log: LogAction }) {
  const container = useGetStaticPopupContainer()()
  return (
    <StoryColumn>
      {['Default', 'Grouped', 'Invalid', 'Disabled', 'Empty'].map((label) => (
        <Field key={label} label={label}>
          <Select
            items={[
              ...basicOptions,
              { label: 'Object', value: 'object' },
              {
                label: 'Array with an intentionally long label',
                value: 'array',
              },
            ]}
            defaultValue={label === 'Empty' ? null : 'string'}
            disabled={label === 'Disabled'}
            onValueChange={(next) => log(`${label.toLowerCase()}.change`, next)}
          >
            <SelectTrigger aria-label={label} aria-invalid={label === 'Invalid'}>
              <SelectValue placeholder="Choose a type" />
            </SelectTrigger>
            <SelectContent container={container}>
              <SelectOptions grouped={label === 'Grouped'} />
            </SelectContent>
          </Select>
        </Field>
      ))}
    </StoryColumn>
  )
}

function MultiSelectStory({ log }: { readonly log: LogAction }) {
  const container = useGetStaticPopupContainer()()
  return (
    <StoryColumn>
      <Field label="Multiple values">
        <Select items={basicOptions} multiple defaultValue={['string', 'number']} onValueChange={(next) => log('multi.change', next)}>
          <SelectTrigger aria-label="Multiple values">
            <SelectValue placeholder="Choose types" />
          </SelectTrigger>
          <SelectContent container={container}>
            <SelectOptions />
          </SelectContent>
        </Select>
      </Field>
    </StoryColumn>
  )
}

function DateSample({
  log,
  label,
  format,
  initialValue,
  disabled = false,
}: {
  log: LogAction
  label: string
  format: DateFormat
  initialValue: string
  disabled?: boolean
}) {
  const [value, setValue] = useState<unknown>(initialValue)
  return (
    <Field label={label}>
      <DateEditor
        label={label}
        format={format}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          setValue(next)
          log(`${format}.change`, next)
        }}
      />
    </Field>
  )
}

function DateTimeStory({ log }: { readonly log: LogAction }) {
  return (
    <div className="story-column story-dates">
      <DateSample log={log} label="Date" format="date" initialValue="2026-09-03" />
      <DateSample log={log} label="Date and time" format="date-time" initialValue="2026-09-03T09:30:00+08:00" />
      <DateSample log={log} label="Time" format="time" initialValue="09:30:00+08:00" />
      <DateSample log={log} label="Empty date" format="date" initialValue="" />
      <DateSample log={log} label="Disabled" format="date" initialValue="2026-09-03" disabled />
    </div>
  )
}

function PopupStory({ log }: { readonly log: LogAction }) {
  const container = useGetStaticPopupContainer()()
  return (
    <div className="story-row">
      <DropdownMenu onOpenChange={(open) => log('dropdown.open', open)}>
        <DropdownMenuTrigger render={<Button>Dropdown</Button>} />
        <DropdownMenuContent container={container}>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => log('dropdown.rename')}>Rename</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent container={container}>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => log('dropdown.duplicate')}>Duplicate</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem variant="destructive" onClick={() => log('dropdown.delete')}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover onOpenChange={(open) => log('popover.open', open)}>
        <PopoverTrigger render={<Button>Popover</Button>} />
        <PopoverContent container={container}>Popup content rendered in the selected container.</PopoverContent>
      </Popover>
      <CanvasTooltip getPopupContainer={() => container} title="Designer tooltip">
        <Button>Tooltip</Button>
      </CanvasTooltip>
    </div>
  )
}

function ContextMenuStory({ log }: { readonly log: LogAction }) {
  const container = useGetStaticPopupContainer()()
  return (
    <ContextMenu onOpenChange={(open) => log('context.open', open)}>
      <ContextMenuTrigger className="context-target">Right-click anywhere in this target</ContextMenuTrigger>
      <ContextMenuContent container={container}>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => log('context.copy')}>Copy</ContextMenuItem>
          <ContextMenuItem onClick={() => log('context.delete')} variant="destructive">
            Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CanvasChromeStory({
  children,
  language,
  log,
  miniMapOpen,
}: {
  readonly children: ReactNode
  readonly language: UiLanguage
  readonly log: LogAction
  readonly miniMapOpen: boolean
}) {
  const i18n = useMemo(() => createDesignerI18n(language), [language])
  const interactiveMode$ = useMemo(() => val<'mouse' | 'touchpad'>('touchpad'), [])
  const miniMapExpanded$ = useMemo(() => val<boolean | undefined>(miniMapOpen), [])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const popup = useMemo(
    () => ({
      default: () => stageRef.current || document.body,
      static: () => stageRef.current || document.body,
    }),
    [],
  )

  useEffect(() => () => i18n.dispose(), [i18n])

  return (
    <GetPopupContainerContext.Provider value={popup}>
      <div className="run-control-story-stage" data-canvas-control-scope ref={stageRef}>
        <ReactFlowProvider>
          <I18nProvider i18n={i18n}>
            <CornerControls leading={<CanvasInteractiveMode interactiveMode$={interactiveMode$} />} miniMapExpanded$={miniMapExpanded$}>
              <WorkbenchInspectorToggle label="Toggle inspector" open={inspectorOpen} onToggle={() => setInspectorOpen((open) => !open)} />
            </CornerControls>
            <CanvasViewControls
              maxZoomReached={false}
              minZoomReached={false}
              onFitView={() => log('canvas.fit')}
              onRelayout={() => log('canvas.layout')}
              onZoomIn={() => log('canvas.zoom', 'in')}
              onZoomOut={() => log('canvas.zoom', 'out')}
              onZoomReset={() => log('canvas.zoom', 'reset')}
              zoom={1}
            />
          </I18nProvider>
          <CanvasToolbar>{children}</CanvasToolbar>
        </ReactFlowProvider>
      </div>
    </GetPopupContainerContext.Provider>
  )
}

function InteractionModeStory({ dark, language }: { readonly dark: boolean; readonly language: UiLanguage }) {
  const i18n = useMemo(() => createDesignerI18n(language), [language])
  const mouse$ = useMemo(() => val<'mouse' | 'touchpad'>('mouse'), [])
  const touchpad$ = useMemo(() => val<'mouse' | 'touchpad'>('touchpad'), [])
  useEffect(() => () => i18n.dispose(), [i18n])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-canvas-root open-flow-theme"
        data-surface="canvas"
        data-theme={dark ? 'dark' : 'light'}
        style={{
          display: 'grid',
          width: '100%',
          alignSelf: 'start',
          gap: 24,
          padding: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        {(
          [
            ['Mouse selected', mouse$],
            ['Touchpad selected', touchpad$],
          ] as const
        ).map(([label, mode]) => (
          <InteractionModeSample key={label} label={label} mode={mode} />
        ))}
      </div>
    </I18nProvider>
  )
}

function InteractionModeSample({ label, mode }: { readonly label: string; readonly mode: ReturnType<typeof val<'mouse' | 'touchpad'>> }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const popup = useMemo(
    () => ({
      default: () => container || document.body,
      static: () => container || document.body,
    }),
    [container],
  )
  return (
    <div
      style={{
        position: 'relative',
        minHeight: 256,
        containerType: 'inline-size',
      }}
      ref={setContainer}
    >
      <div className="mb-4 text-sm text-muted-foreground">{label}</div>
      {container && (
        <GetPopupContainerContext.Provider value={popup}>
          <div className="flex justify-end">
            <CanvasInteractiveMode defaultOpen interactiveMode$={mode} />
          </div>
        </GetPopupContainerContext.Provider>
      )}
    </div>
  )
}

function RunControlSample({
  defaultOpen = false,
  disabled = false,
  inputStatus,
  language,
  label,
  log,
  miniMapOpen = false,
  starting = false,
  triggers,
}: {
  readonly defaultOpen?: boolean
  readonly disabled?: boolean
  readonly inputStatus: 'missing' | 'none' | 'ready'
  readonly language: UiLanguage
  readonly label: string
  readonly log: LogAction
  readonly miniMapOpen?: boolean
  readonly starting?: boolean
  readonly triggers: readonly {
    readonly id: string
    readonly title: string
    readonly icon?: string
  }[]
}) {
  const [inputOpen, setInputOpen] = useState(defaultOpen)
  const [selectedTriggerId, setSelectedTriggerId] = useState(triggers[0]!.id)
  return (
    <section className="run-control-sample">
      <div className="run-control-story-label">
        <strong>{label}</strong>
        <span>{inputStatus == 'none' ? 'No test data' : inputStatus == 'ready' ? 'Test data ready' : 'Test data required'}</span>
      </div>
      <CanvasChromeStory language={language} log={log} miniMapOpen={miniMapOpen}>
        <WorkbenchCanvasActions
          blocksOpen={false}
          disabled={disabled}
          onOpenBlocks={() => log('blocks.open')}
          runControl={
            <RunControl
              disabled={disabled}
              inputContent={
                <div className="run-control-story-inputs">
                  <header>
                    <strong>Test data</strong>
                    <span>{triggers.find((trigger) => trigger.id == selectedTriggerId)?.title}</span>
                  </header>
                  <UiField>
                    <FieldLabel htmlFor={`story-payload-${label}`}>payload</FieldLabel>
                    <Textarea defaultValue={'{\n  "event": "created"\n}'} id={`story-payload-${label}`} rows={4} />
                  </UiField>
                  <Button onClick={() => log('run-control.start', selectedTriggerId)} size="sm">
                    Start test
                  </Button>
                </div>
              }
              inputOpen={inputOpen}
              inputStatus={inputStatus}
              onInputOpenChange={(open) => {
                setInputOpen(open)
                log('run-control.inputs', open)
              }}
              onRun={() => log('run-control.run', selectedTriggerId)}
              onSelectTrigger={(triggerId) => {
                setInputOpen(false)
                setSelectedTriggerId(triggerId)
                log('run-control.trigger', triggerId)
              }}
              selectedTriggerId={selectedTriggerId}
              starting={starting}
              triggers={triggers}
            />
          }
        />
      </CanvasChromeStory>
    </section>
  )
}

function RunControlStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createWorkbenchI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  const one = [{ id: 'schedule', title: 'Daily schedule', icon: ':carbon:time:' }]
  const multiple = [
    { id: 'schedule', title: 'Daily schedule', icon: ':carbon:time:' },
    { id: 'webhook', title: 'Order webhook', icon: ':carbon:webhook:' },
    { id: 'manual', title: 'Manual trigger', icon: ':carbon:play:' },
  ]
  return (
    <I18nProvider i18n={i18n}>
      <div className="run-control-stories open-flow-workbench" data-theme={dark ? 'dark' : 'light'}>
        <div className="run-control-story-grid">
          <RunControlSample inputStatus="none" language={language} label="Direct run" log={log} triggers={one} />
          <RunControlSample defaultOpen inputStatus="missing" language={language} label="Input required" log={log} triggers={[multiple[1]!]} />
          <RunControlSample inputStatus="ready" language={language} label="Remembered input" log={log} triggers={[multiple[1]!]} />
          <RunControlSample inputStatus="none" language={language} label="Multiple triggers" log={log} triggers={multiple} />
          <RunControlSample inputStatus="ready" language={language} label="Starting" log={log} starting triggers={[multiple[1]!]} />
          <RunControlSample disabled inputStatus="missing" language={language} label="Draft has problems" log={log} triggers={[multiple[1]!]} />
          <RunControlSample inputStatus="none" language={language} label="Mini map open" log={log} miniMapOpen triggers={one} />
        </div>
      </div>
    </I18nProvider>
  )
}

function StoryColumn({ children }: { readonly children: ReactNode }) {
  return <div className="story-column">{children}</div>
}
function Field({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div className="story-field nodrag">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  )
}

export const stories: readonly FrontendStory[] = [
  {
    group: 'Canvas',
    id: 'interaction-mode',
    render: (_log, dark, language) => <InteractionModeStory dark={dark} language={language} />,
    standalone: true,
    title: 'Interaction Mode',
  },
  {
    group: 'Controls',
    id: 'select',
    render: (log) => <SelectStory log={log} />,
    title: 'Select',
  },
  {
    group: 'Controls',
    id: 'multi-select',
    render: (log) => <MultiSelectStory log={log} />,
    title: 'Multi Select',
  },
  {
    group: 'Controls',
    id: 'date-time',
    render: (log) => <DateTimeStory log={log} />,
    title: 'Date & Time',
  },
  {
    group: 'Popup',
    id: 'popup',
    render: (log) => <PopupStory log={log} />,
    title: 'Dropdown, Popover & Tooltip',
  },
  {
    group: 'Popup',
    id: 'context-menu',
    render: (log) => <ContextMenuStory log={log} />,
    title: 'Context Menu',
  },
  {
    group: 'Workbench',
    id: 'run-control-states',
    description: 'Run controls inside the canvas toolbar, with input, validation and execution states.',
    render: (log, dark, language) => <RunControlStory dark={dark} language={language} log={log} />,
    standalone: true,
    title: 'Run Control States',
  },
]
