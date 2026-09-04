import type { ReactNode } from 'react'
import type { DesignerOption } from '../../src/designer/browser/components/select.tsx'
import type { UiLanguage } from '../../src/localization/common/languages.ts'

import { useState } from 'react'
import { DateTimePicker } from '../../src/designer/browser/components/dateTimePicker.tsx'
import { DesignerCombobox } from '../../src/designer/browser/components/select.tsx'
import { DesignerTooltip } from '../../src/designer/browser/components/tooltip.tsx'
import { useGetStaticPopupContainer } from '../../src/designer/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
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
import { Popover, PopoverContent, PopoverTrigger } from '../../src/ui/browser/popover.tsx'

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
]
