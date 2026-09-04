import type { ReactNode } from 'react'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { DesignerCheckbox } from '../../src/designer/browser/components/checkbox.tsx'
import { Input as DesignerInput } from '../../src/designer/browser/components/input.tsx'
import { Null } from '../../src/designer/browser/components/null.tsx'
import { Range } from '../../src/designer/browser/components/range.tsx'
import { LabeledSwitch } from '../../src/designer/browser/components/toggleSwitch.tsx'
import { designerThemeClass } from '../../src/designer/browser/theme/designerThemeClass.ts'
import { Alert, AlertDescription, AlertTitle } from '../../src/ui/browser/alert.tsx'
import { Badge } from '../../src/ui/browser/badge.tsx'
import { Button } from '../../src/ui/browser/button.tsx'
import { Checkbox } from '../../src/ui/browser/checkbox.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { Progress } from '../../src/ui/browser/progress.tsx'
import { Switch } from '../../src/ui/browser/switch.tsx'
import { Textarea } from '../../src/ui/browser/textarea.tsx'
import { stories } from './stories.tsx'

const designerTokens = [
  {
    title: 'Canvas & nodes',
    tokens: ['--flow-bg', '--node-background-color', '--node-head-background-color', '--node-border-color', '--node-selected-border-color'],
  },
  {
    title: 'Fields & popups',
    tokens: [
      '--widget-background',
      '--widget-input-background',
      '--widget-border-color',
      '--widget-popup-background',
      '--widget-input-selection-background-color',
    ],
  },
  { title: 'Text', tokens: ['--text-1', '--text-2', '--text-3', '--text-4', '--text-5'] },
  {
    title: 'Connections & feedback',
    tokens: [
      '--edge-color',
      '--edge-string',
      '--edge-primitive',
      '--edge-bin',
      '--edge-error',
      '--widget-success-progress-color',
      '--widget-error-progress-color',
      '--widget-error-input-background',
    ],
  },
]

const productTokens = [
  { title: 'Surfaces', tokens: ['--ui-background', '--ui-card', '--ui-popover', '--ui-secondary', '--ui-muted', '--ui-accent'] },
  { title: 'Text & actions', tokens: ['--ui-foreground', '--ui-muted-foreground', '--ui-primary', '--ui-primary-foreground', '--ui-destructive'] },
  { title: 'Borders & focus', tokens: ['--ui-border', '--ui-input', '--ui-ring'] },
]

function Sample({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="overview-sample">
      <h2>{title}</h2>
      <div className="overview-sample-body">{children}</div>
    </section>
  )
}

function ButtonSamples({ log }: { readonly log: LogAction }) {
  return (
    <div className="overview-buttons">
      {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
        <Button key={variant} variant={variant} size="sm" onClick={() => log('button.click', variant)}>
          {variant}
        </Button>
      ))}
      <Button disabled size="sm">
        Disabled
      </Button>
    </div>
  )
}

function ControlOverview({ log, dark, language }: { readonly log: LogAction; readonly dark: boolean; readonly language: UiLanguage }) {
  return (
    <div className="overview-controls">
      <Sample title="Text & validation">
        <DesignerInput ariaLabel="Default input" value="Workflow input" onChange={(value) => log('input.change', value)} />
        <DesignerInput ariaLabel="Empty input" placeholder="Placeholder" />
        <DesignerInput ariaLabel="Invalid input" ariaInvalid warning="A valid value is required." value="Invalid value" />
        <DesignerInput ariaLabel="Read-only input" readOnly value="Read-only value" />
        <DesignerInput ariaLabel="Disabled input" disabled value="Disabled value" />
        <DesignerInput ariaLabel="Multiline input" multiline value={'Summarize the records.\nReturn a short Markdown digest.'} />
      </Sample>
      <Sample title="Boolean & numeric values">
        <LabeledSwitch label="Enabled" defaultChecked onChange={(value) => log('switch.change', value)} />
        <LabeledSwitch label="Off" onChange={(value) => log('switch.change', value)} />
        <LabeledSwitch label="Disabled" defaultChecked disabled />
        <DesignerCheckbox label="Checked" defaultChecked onChange={(value) => log('checkbox.change', value)} />
        <DesignerCheckbox label="Unchecked" onChange={(value) => log('checkbox.change', value)} />
        <DesignerCheckbox label="Disabled" defaultChecked disabled />
        <Range label="Temperature" min={0} max={1} step={0.1} defaultValue={0.7} onChange={(value) => log('range.change', value)} />
        <Range label="Disabled" min={0} max={100} defaultValue={40} disabled />
        <div>
          Nullable value <Null />
        </div>
      </Sample>
      {stories
        .filter((story) => ['select', 'multi-select', 'date-time', 'popup'].includes(story.id))
        .map((story) => (
          <Sample key={story.id} title={story.title}>
            {story.render(log, dark, language)}
          </Sample>
        ))}
      <Sample title="Buttons">
        <ButtonSamples log={log} />
      </Sample>
    </div>
  )
}

function ProductOverview({ log }: { readonly log: LogAction }) {
  return (
    <div className="product-overview open-flow-workbench">
      <div className="overview-controls">
        <Sample title="Actions">
          <ButtonSamples log={log} />
        </Sample>
        <Sample title="Inputs">
          <Input aria-label="Default input" defaultValue="Daily digest" onChange={(event) => log('input.change', event.target.value)} />
          <Input aria-label="Empty input" placeholder="Search workflows" />
          <Input aria-label="Invalid input" aria-invalid defaultValue="Invalid value" />
          <Input aria-label="Disabled input" disabled defaultValue="Disabled value" />
          <Textarea aria-label="Description" defaultValue="Summarize new records and prepare a digest." />
        </Sample>
        <Sample title="Choices">
          <div className="overview-inline">
            <Switch aria-label="Enabled" defaultChecked onCheckedChange={(value) => log('switch.change', value)} />
            <span>Enabled</span>
          </div>
          <div className="overview-inline">
            <Switch aria-label="Off" />
            <span>Off</span>
          </div>
          <div className="overview-inline">
            <Switch aria-label="Disabled switch" disabled defaultChecked />
            <span>Disabled</span>
          </div>
          <div className="overview-inline">
            <Checkbox aria-label="Selected" defaultChecked onCheckedChange={(value) => log('checkbox.change', value)} />
            <span>Selected</span>
          </div>
          <div className="overview-inline">
            <Checkbox aria-label="Mixed" indeterminate />
            <span>Mixed</span>
          </div>
        </Sample>
        <Sample title="Badges">
          <div className="overview-buttons">
            {(['default', 'secondary', 'outline', 'destructive'] as const).map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
        </Sample>
        <Sample title="Feedback">
          <Alert>
            <AlertTitle>Ready to run</AlertTitle>
            <AlertDescription>All required inputs are configured.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription>The sample connection is unavailable.</AlertDescription>
          </Alert>
          <Progress aria-label="Sample run progress" value={42} />
        </Sample>
      </div>
    </div>
  )
}

function Swatches({ groups }: { readonly groups: typeof designerTokens }) {
  return (
    <>
      {groups.map((group) => (
        <section className="palette-group" key={group.title}>
          <h3>{group.title}</h3>
          <div className="palette-grid">
            {group.tokens.map((token) => (
              <div className="palette-swatch" key={token}>
                <div className="palette-color" style={{ background: `var(${token})` }} />
                <code>{token}</code>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function PaletteOverview({ dark }: { readonly dark: boolean }) {
  return (
    <div className="palette-overview">
      <div className={`palette-panel oo-designer-root ${designerThemeClass(dark)}`} data-theme={dark ? 'dark' : 'light'}>
        <h2>Designer · Canvas content</h2>
        <p>Nodes, ports, connections and compact editors.</p>
        <Swatches groups={designerTokens} />
      </div>
      <div className="palette-panel open-flow-workbench">
        <h2>Product · Workbench & canvas controls</h2>
        <p>Shared surfaces, buttons, panels and focus rings.</p>
        <Swatches groups={productTokens} />
      </div>
    </div>
  )
}

export const overviewStories: readonly DesignerStory[] = [
  {
    group: 'Theme Preview',
    id: 'node-controls',
    title: 'Node controls',
    render: (log, dark, language) => <ControlOverview log={log} dark={dark} language={language} />,
  },
  { group: 'Theme Preview', id: 'product-controls', title: 'Workbench controls', standalone: true, render: (log) => <ProductOverview log={log} /> },
  { group: 'Theme Preview', id: 'palette', title: 'Theme palette', standalone: true, render: (_log, dark) => <PaletteOverview dark={dark} /> },
]
