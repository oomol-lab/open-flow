import type { ReactNode } from 'react'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { Input as CanvasInput } from '../../src/canvas/browser/components/input.tsx'
import { Alert, AlertDescription, AlertTitle } from '../../src/ui/browser/alert.tsx'
import { Badge } from '../../src/ui/browser/badge.tsx'
import { Button } from '../../src/ui/browser/button.tsx'
import { Checkbox } from '../../src/ui/browser/checkbox.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../src/ui/browser/input-group.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { Label } from '../../src/ui/browser/label.tsx'
import { Progress } from '../../src/ui/browser/progress.tsx'
import { Switch } from '../../src/ui/browser/switch.tsx'
import { Textarea } from '../../src/ui/browser/textarea.tsx'
import { stories } from './stories.tsx'

const canvasTokens = [
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
      '--edge-selected',
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
        <CanvasInput ariaLabel="Default input" value="Workflow input" onChange={(value) => log('input.change', value)} />
        <CanvasInput ariaLabel="Empty input" placeholder="Placeholder" />
        <CanvasInput ariaLabel="Invalid input" ariaInvalid warning="A valid value is required." value="Invalid value" />
        <CanvasInput ariaLabel="Read-only input" readOnly value="Read-only value" />
        <CanvasInput ariaLabel="Disabled input" disabled value="Disabled value" />
        <CanvasInput ariaLabel="Multiline input" multiline value={'Summarize the records.\nReturn a short Markdown digest.'} />
      </Sample>
      <Sample title="Boolean values">
        {['Enabled', 'Off', 'Disabled'].map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            <Switch
              id={`node-switch-${index}`}
              size="sm"
              defaultChecked={index !== 1}
              disabled={index === 2}
              onCheckedChange={(value) => log('switch.change', value)}
            />
            <Label htmlFor={`node-switch-${index}`}>{label}</Label>
          </div>
        ))}
        {['Checked', 'Unchecked', 'Disabled'].map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            <Checkbox
              id={`node-checkbox-${index}`}
              defaultChecked={index !== 1}
              disabled={index === 2}
              onCheckedChange={(value) => log('checkbox.change', value)}
            />
            <Label htmlFor={`node-checkbox-${index}`}>{label}</Label>
          </div>
        ))}
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
        <Sample title="Compact keyboard focus">
          <div className="overview-buttons">
            <Button aria-label="Zoom in" size="icon-sm" variant="ghost" onClick={() => log('zoom.in', null)}>
              <i aria-hidden="true" className="i-lucide:zoom-in" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => log('zoom.reset', null)}>
              72%
            </Button>
            <Button size="sm" variant="outline">
              Button
            </Button>
            <Button size="sm" variant="ghost" disabled>
              Disabled
            </Button>
          </div>
        </Sample>
        <Sample title="Inputs">
          <Input aria-label="Default input" defaultValue="Daily digest" onChange={(event) => log('input.change', event.target.value)} />
          <Input aria-label="Empty input" placeholder="Search workflows" />
          <Input aria-label="Invalid input" aria-invalid defaultValue="Invalid value" />
          <Input aria-label="Disabled input" disabled defaultValue="Disabled value" />
          <Textarea aria-label="Description" defaultValue="Summarize new records and prepare a digest." />
          <Textarea aria-label="Empty description" placeholder="Describe what this step should do." />
          <Textarea aria-label="Invalid description" aria-invalid defaultValue="Invalid description" />
          <InputGroup>
            <InputGroupAddon>Search</InputGroupAddon>
            <InputGroupInput aria-label="Grouped input" placeholder="Search workflows" />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon>Search</InputGroupAddon>
            <InputGroupInput aria-label="Invalid grouped input" aria-invalid defaultValue="Invalid value" />
          </InputGroup>
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

function Swatches({ groups }: { readonly groups: typeof canvasTokens }) {
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
      <div className={`palette-panel open-flow-canvas-root open-flow-theme`} data-surface="canvas" data-theme={dark ? 'dark' : 'light'}>
        <h2>Designer · Canvas content</h2>
        <p>Nodes, ports, connections and compact editors.</p>
        <Swatches groups={canvasTokens} />
      </div>
      <div className="palette-panel open-flow-workbench">
        <h2>Product · Workbench & canvas controls</h2>
        <p>Shared surfaces, buttons, panels and focus rings.</p>
        <Swatches groups={productTokens} />
      </div>
    </div>
  )
}

export const overviewStories: readonly FrontendStory[] = [
  {
    group: 'Theme Preview',
    id: 'node-controls',
    title: 'Node controls',
    render: (log, dark, language) => <ControlOverview log={log} dark={dark} language={language} />,
  },
  {
    group: 'Theme Preview',
    id: 'product-controls',
    title: 'Workbench controls',
    description: 'Text inputs use one focus ring for pointer and keyboard focus, including invalid and grouped fields.',
    standalone: true,
    render: (log) => <ProductOverview log={log} />,
  },
  { group: 'Theme Preview', id: 'palette', title: 'Theme palette', standalone: true, render: (_log, dark) => <PaletteOverview dark={dark} /> },
]
