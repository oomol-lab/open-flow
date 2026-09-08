import type { ReactNode } from 'react'
import type { DesignerOption } from '../../src/designer/browser/components/select.tsx'
import type { UiLanguage } from '../../src/localization/common/languages.ts'

import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { DateTimePicker } from '../../src/designer/browser/components/dateTimePicker.tsx'
import { DesignerCombobox } from '../../src/designer/browser/components/select.tsx'
import { DesignerTooltip } from '../../src/designer/browser/components/tooltip.tsx'
import { CanvasInteractiveMode, CanvasToolbar, CanvasViewControls } from '../../src/designer/browser/graph/ReactFlowContainer/CanvasControls.tsx'
import { CornerControls } from '../../src/designer/browser/graph/ReactFlowContainer/CornerControls.tsx'
import { GetPopupContainerContext, useGetStaticPopupContainer } from '../../src/designer/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n as createDesignerI18n } from '../../src/designer/browser/i18n/i18n-loader.ts'
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
import { Textarea } from '../../src/ui/browser/textarea.tsx'
import { createI18n as createWorkbenchI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { Icon } from '../../src/workbench/browser/runtime/icons.tsx'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'

export type LogAction = (name: string, value?: unknown) => void

export interface DesignerStory {
  readonly group: string
  readonly id: string
  readonly render: (log: LogAction, dark: boolean, language: UiLanguage) => ReactNode
  readonly standalone?: boolean
  readonly title: string
}

const basicOptions: readonly DesignerOption[] = [
  { icon: 'i-codicon:code', label: 'String', value: 'string' },
  { icon: 'i-codicon:symbol-property', label: 'Number', value: 'number' },
  { icon: 'i-codicon:check', label: 'Boolean', value: 'boolean' },
  { isDisabled: true, label: 'Disabled option', value: 'disabled' },
]

const groupedOptions = [
  { label: 'Primitive', value: 'primitive', options: basicOptions },
  {
    label: 'Structured',
    value: 'structured',
    options: [
      { icon: 'i-codicon:package', label: 'Object', value: 'object' },
      { icon: 'i-codicon:layers', label: 'Array with an intentionally long label', value: 'array' },
    ],
  },
]

function SelectStory({ log }: { readonly log: LogAction }) {
  const [value, setValue] = useState<DesignerOption | null>(basicOptions[0]!)
  return (
    <StoryColumn>
      <Field label="Default">
        <DesignerCombobox
          options={basicOptions}
          value={value}
          isClearable
          onChange={(next) => {
            setValue(next)
            log('select.change', next)
          }}
        />
      </Field>
      <Field label="Grouped">
        <DesignerCombobox options={groupedOptions} labelInMenu="Hover a group to inspect its submenu" onChange={(next) => log('grouped.change', next)} />
      </Field>
      <Field label="Danger">
        <DesignerCombobox options={basicOptions} variant="danger" value={basicOptions[1]} />
      </Field>
      <Field label="Disabled">
        <DesignerCombobox disabled options={basicOptions} value={basicOptions[2]} />
      </Field>
    </StoryColumn>
  )
}

function MultiSelectStory({ log }: { readonly log: LogAction }) {
  const [value, setValue] = useState<readonly DesignerOption[]>([basicOptions[0]!, basicOptions[1]!])
  return (
    <StoryColumn>
      <Field label="Multiple values">
        <DesignerCombobox
          isMulti
          isClearable
          options={basicOptions}
          value={value}
          onChange={(next) => {
            setValue(next)
            log('multi.change', next)
          }}
        />
      </Field>
    </StoryColumn>
  )
}

function DateTimeStory({ log }: { readonly log: LogAction }) {
  const [date, setDate] = useState<Date | null>(new Date(2026, 8, 3, 9, 30))
  return (
    <StoryColumn>
      <Field label="Date">
        <DateTimePicker
          isClearable
          value={date}
          onChange={(next) => {
            setDate(next)
            log('date.change', next)
          }}
        />
      </Field>
      <Field label="Date and time">
        <DateTimePicker showDate showTime defaultValue={new Date(2026, 8, 3, 9, 30)} isClearable onChange={(next) => log('datetime.change', next)} />
      </Field>
      <Field label="Time">
        <DateTimePicker showDate={false} showTime defaultValue={new Date(2026, 8, 3, 9, 30)} onChange={(next) => log('time.change', next)} />
      </Field>
      <Field label="Disabled">
        <DateTimePicker disabled value={new Date(2026, 8, 3, 9, 30)} />
      </Field>
    </StoryColumn>
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
      <DesignerTooltip getPopupContainer={() => container} title="Designer tooltip">
        <Button>Tooltip</Button>
      </DesignerTooltip>
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
            <CornerControls leading={<CanvasInteractiveMode interactiveMode$={interactiveMode$} />} miniMapExpanded$={miniMapExpanded$} />
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
  readonly triggers: readonly { readonly id: string; readonly title: string }[]
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
        <>
          <Button size="default" type="button" variant="ghost">
            <Icon data-icon="inline-start" name="plus" /> Add node
          </Button>
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
        </>
      </CanvasChromeStory>
    </section>
  )
}

function RunControlStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createWorkbenchI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  const one = [{ id: 'schedule', title: 'Daily schedule' }]
  const multiple = [
    { id: 'schedule', title: 'Daily schedule' },
    { id: 'webhook', title: 'Order webhook' },
  ]
  return (
    <I18nProvider i18n={i18n}>
      <div className="run-control-stories open-flow-workbench" data-theme={dark ? 'dark' : 'light'}>
        <header>
          <strong>Run control states</strong>
          <p>Run controls are rendered inside the production canvas toolbar alongside the production canvas chrome.</p>
        </header>
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

export const stories: readonly DesignerStory[] = [
  { group: 'Controls', id: 'select', render: (log) => <SelectStory log={log} />, title: 'Select' },
  { group: 'Controls', id: 'multi-select', render: (log) => <MultiSelectStory log={log} />, title: 'Multi Select' },
  { group: 'Controls', id: 'date-time', render: (log) => <DateTimeStory log={log} />, title: 'Date & Time' },
  { group: 'Popup', id: 'popup', render: (log) => <PopupStory log={log} />, title: 'Dropdown, Popover & Tooltip' },
  { group: 'Popup', id: 'context-menu', render: (log) => <ContextMenuStory log={log} />, title: 'Context Menu' },
  {
    group: 'Workbench',
    id: 'run-control-states',
    render: (log, dark, language) => <RunControlStory dark={dark} language={language} log={log} />,
    standalone: true,
    title: 'Run Control States',
  },
]
