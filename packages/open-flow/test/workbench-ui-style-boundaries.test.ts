import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { test } from 'vitest'

const packageRoot = new URL('..', import.meta.url)
const workbenchStyleImports = [
  "@import '../../../ui/browser/theme.css';",
  "@import '../../../ui/browser/styles.css';",
  "@import './styles/tokens.css';",
  "@import './styles/shell.css';",
  "@import './styles/resource-browser.css';",
  "@import './styles/status.css';",
  "@import './styles/workspace.css';",
  "@import './styles/canvas.css';",
  "@import './styles/context-panel.css';",
  "@import './styles/runs.css';",
  "@import './styles/publications.css';",
  "@import './styles/responsive.css';",
] as const

const sharedUiTokens = [
  '--ui-accent',
  '--ui-accent-foreground',
  '--ui-background',
  '--ui-border',
  '--ui-card',
  '--ui-card-foreground',
  '--ui-destructive',
  '--ui-foreground',
  '--ui-input',
  '--ui-muted',
  '--ui-muted-foreground',
  '--ui-popover',
  '--ui-popover-foreground',
  '--ui-primary',
  '--ui-primary-foreground',
  '--ui-radius',
  '--ui-ring',
  '--ui-secondary',
  '--ui-secondary-foreground',
] as const

const reactFlowThemeContract = {
  '--xy-controls-box-shadow': 'var(--floating-control-shadow)',
  '--xy-controls-button-background-color': 'var(--ui-background)',
  '--xy-controls-button-background-color-hover': 'var(--ui-muted)',
  '--xy-controls-button-border-color': 'var(--ui-border)',
  '--xy-controls-button-color': 'var(--ui-muted-foreground)',
  '--xy-controls-button-color-hover': 'var(--ui-foreground)',
  '--xy-minimap-background-color': 'var(--node-background-color)',
  '--xy-minimap-mask-background-color': 'rgb(0 0 0 / 10%)',
  '--xy-minimap-node-background-color': 'var(--widget-background)',
} as const

function declarations(source: string, prefix: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(new RegExp(`(${prefix}[\\w-]+)\\s*:\\s*([^;]+);`, 'g'))].map((match) => [match[1]!, match[2]!.trim()]))
}

function referencedTokens(source: string, prefix: string): string[] {
  return [...new Set([...source.matchAll(new RegExp(`var\\((${prefix}[\\w-]+)`, 'g'))].map((match) => match[1]!))].toSorted()
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

test('keeps browser control normalization below Workbench component utilities', async () => {
  const [uiStyles, workbenchStyles] = await Promise.all([
    readFile(new URL('src/ui/browser/styles.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles.css', packageRoot), 'utf8'),
  ])

  assert.match(uiStyles, /@layer theme, base, utilities;/)
  assert.match(uiStyles, /@layer base \{[\s\S]*?:where\(\.open-flow-workbench, \.oo-designer-root\) button/)
  assert.match(uiStyles, /border: 0 solid;/)
  assert.doesNotMatch(workbenchStyles, /\n  button,\n  input,\n  select,\n  textarea \{/)
  assert.doesNotMatch(workbenchStyles, /\n  button \{\n    border: 0;/)
})

test('keeps Workbench feature styles in their original cascade order', async () => {
  const [entry, tokens, shell, resourceBrowser, status, workspace, canvas, contextPanel, runs, publications, responsive] = await Promise.all([
    readFile(new URL('src/workbench/browser/runtime/styles.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/tokens.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/shell.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/resource-browser.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/status.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/workspace.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/canvas.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/context-panel.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/runs.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/publications.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/responsive.css', packageRoot), 'utf8'),
  ])

  assert.deepEqual(
    [...entry.matchAll(/^@import [^;]+;/gm)].map((match) => match[0]),
    workbenchStyleImports,
  )
  for (const source of [tokens, shell, resourceBrowser, status, workspace, canvas, contextPanel, runs, publications, responsive]) {
    assert.match(source, /^\.open-flow-workbench \{/)
  }
  assert.match(tokens, /background: var\(--ui-background\)/)
  assert.doesNotMatch(tokens, /--ui-[\w-]+\s*:/)
  assert.match(shell, /\.app-shell \{/)
  assert.match(resourceBrowser, /\.resource-browser \{/)
  assert.match(status, /\.status-dot \{/)
  assert.match(workspace, /\.workspace \{/)
  assert.match(canvas, /\.canvas-panel \{/)
  assert.match(contextPanel, /\.context-panel \{/)
  assert.match(runs, /\.run-drawer \{/)
  assert.match(publications, /\.publication-view \{/)
  assert.match(responsive, /@container open-flow-workbench/)
  assert.equal(entry.trim(), workbenchStyleImports.join('\n'))
})

test('keeps Resource Browser primitives on shared visual ownership', async () => {
  const [browser, createDialog, hostMenu, dialog, select, workbenchSelect, resourceStyles, workspaceStyles] = await Promise.all([
    readFile(new URL('src/workbench/browser/runtime/shell/resourceBrowser.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/createResourceDialog.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/hostMenu.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/ui/browser/dialog.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/ui/browser/select.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/workbenchSelect.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/resource-browser.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/workspace.css', packageRoot), 'utf8'),
  ])

  assert.doesNotMatch(browser, /aria-pressed=/)
  assert.match(createDialog, /Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle/)
  assert.match(createDialog, /Field, FieldDescription, FieldError, FieldGroup, FieldLabel/)
  assert.match(createDialog, /<DialogContent container=\{portal\.current\}/)
  assert.match(createDialog, /<Field data-invalid=\{showIssue\}>/)
  assert.doesNotMatch(createDialog, /DialogOverlay|DialogPortal|resource-dialog-/)
  assert.match(hostMenu, /from '\.\.\/\.\.\/\.\.\/\.\.\/ui\/browser\/button\.tsx'/)
  assert.match(hostMenu, /from '\.\.\/\.\.\/\.\.\/\.\.\/ui\/browser\/dropdown-menu\.tsx'/)
  assert.match(hostMenu, /container=\{root\}/)
  assert.doesNotMatch(hostMenu, /pointerdown|keydown|role="dialog"|position:\s*absolute/)
  assert.match(dialog, /data-slot="dialog-overlay"/)
  assert.match(dialog, /data-slot="dialog-content"/)
  assert.match(dialog, /readonly container\?: HTMLElement \| null/)
  assert.match(dialog, /bg-popover/)
  assert.match(dialog, /motion-reduce:animate-none/)
  assert.match(select, /readonly container\?: HTMLElement \| null/)
  assert.match(select, /bg-popover/)
  assert.match(select, /z-50/)
  assert.match(select, /motion-reduce:animate-none/)
  assert.match(workbenchSelect, /<SelectContent align="end" alignItemWithTrigger=\{false\} container=\{portalRoot\}>/)
  assert.doesNotMatch(workbenchSelect, /SelectPortal|SelectPositioner|SelectList|SelectItemIndicator|SelectItemText|workbench-select-/)
  assert.doesNotMatch(resourceStyles, /\.resource-row-form input|\.resource-dialog-field|\.resource-list-row:hover|\.resource-list-row:disabled/)
  assert.doesNotMatch(resourceStyles, /\.resource-dialog-|\.workbench-select-/)
  assert.doesNotMatch(resourceStyles, /\.workspace-title/)
  assert.doesNotMatch(workspaceStyles, /\.workspace-title button/)
  const rowRules = [...resourceStyles.matchAll(/\.resource-list-row \{([^}]*)\}/g)]
  assert.ok(rowRules.length >= 2)
  assert.doesNotMatch(rowRules.at(-1)![1]!, /background:|color:/)
})

test('keeps the public session gate on shared form primitives', async () => {
  const source = await readFile(new URL('src/workbench/browser/runtime/openFlowWorkbench.tsx', packageRoot), 'utf8')

  assert.match(source, /export function OpenFlowSessionGate/)
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/ui\/browser\/button\.tsx'/)
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/ui\/browser\/field\.tsx'/)
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/ui\/browser\/input\.tsx'/)
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/ui\/browser\/spinner\.tsx'/)
  assert.match(source, /className="open-flow-workbench"/)
  assert.doesNotMatch(source, /operator-token|value="operator"/)
  assert.doesNotMatch(source, /session-(?:gate|form|error)/)
})

test('keeps Designer node controls in the compact root normalization', async () => {
  const [designerRootStyles, toggleGroup] = await Promise.all([
    readFile(new URL('src/designer/browser/styles/root.scss', packageRoot), 'utf8'),
    readFile(new URL('src/ui/browser/toggle-group.tsx', packageRoot), 'utf8'),
  ])

  assert.match(designerRootStyles, /button:not\(\[data-canvas-control-scope\] button\)/)
  assert.match(designerRootStyles, /:not\(\.react-flow__controls button\)/)
  assert.doesNotMatch(designerRootStyles, /button:not\(\[data-slot\]\)/)
  assert.match(toggleGroup, /group-data-\[spacing=0\]\/toggle-group:rounded-none/)
  assert.match(toggleGroup, /data-\[spacing=0\]:first:rounded/)
  assert.match(toggleGroup, /data-\[spacing=0\]:last:rounded/)
})

test('keeps Workbench feature CSS from reclaiming shared primitive visuals', async () => {
  const [
    button,
    skeleton,
    diagnostics,
    resourceBrowser,
    runInputPanel,
    workbenchDesigner,
    contextPanel,
    runDrawer,
    runs,
    publications,
    workspaceStyles,
    canvasStyles,
    contextPanelStyles,
    runStyles,
    publicationStyles,
    responsiveStyles,
  ] = await Promise.all([
    readFile(new URL('src/ui/browser/button.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/ui/browser/skeleton.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/diagnosticsPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/resourceBrowser.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/runs/runInputPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/designer/workbenchDesigner.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/designer/contextPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/runs/runDrawer.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/runs/runsView.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/publications/publicationsView.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/workspace.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/canvas.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/context-panel.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/runs.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/publications.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/responsive.css', packageRoot), 'utf8'),
  ])

  assert.match(button, /aria-current:bg-muted aria-current:text-foreground/)
  assert.match(skeleton, /motion-reduce:animate-none/)
  assert.match(diagnostics, /className="flex flex-col gap-2\.5 p-4"/)
  assert.match(diagnostics, /<Skeleton className="h-\[76px\]"/)
  assert.match(diagnostics, /<Empty className="min-h-60"/)
  assert.doesNotMatch(diagnostics, /border-0/)
  assert.doesNotMatch(diagnostics, /diagnostics-(?:empty|loading)/)
  assert.doesNotMatch(resourceBrowser, /rounded-none|border-0/)
  assert.match(runInputPanel, /<Alert className="mb-4" variant="destructive">/)
  assert.doesNotMatch(runInputPanel, /run-input-error/)
  assert.match(workbenchDesigner, /aria-expanded=\{blocksOpen\}[\s\S]*?size="default"[\s\S]*?title=\{t\('designer\.openBlocks'\)\}[\s\S]*?variant="outline"/)
  assert.match(workbenchDesigner, /onDeleteNodes\(\)[\s\S]*?size="default"[\s\S]*?variant="destructive"/)
  assert.match(workbenchDesigner, /aria-label=\{t\('designer\.toggleInspector'\)\}[\s\S]*?size="icon"[\s\S]*?variant="outline"/)
  assert.match(workbenchDesigner, /recommendedOptions\.map[\s\S]*?size="sm"[\s\S]*?variant="outline"/)
  assert.match(contextPanel, /<InputGroup>/)
  assert.match(contextPanel, /buttonVariants\(\{ variant: 'ghost' \}\)/)
  assert.match(contextPanel, /<Separator \/>/)
  assert.doesNotMatch(contextPanel, /block-library-search/)
  assert.doesNotMatch(contextPanel, /BlockPickerRow|designerThemeClass/)
  assert.match(runs, /aria-current=\{candidate\.runId == run\?\.runId \? 'true' : undefined\}/)
  assert.match(runs, /className="run-list-item"/)
  assert.match(runs, /className="mx-2 mb-2"[\s\S]*?size="lg"[\s\S]*?variant="outline"/)
  assert.match(runs, /<Empty className="h-full"/)
  assert.match(runs, /<Badge variant="secondary">\{sourceLabel\(run, t\)\}<\/Badge>/)
  assert.doesNotMatch(runs, /border-0/)
  assert.doesNotMatch(runs, /className="run-tabs"/)
  assert.doesNotMatch(runDrawer, /className="run-tabs"/)
  assert.match(runDrawer, /aria-label=\{t\(open \? 'run\.collapse' : 'run\.expand'\)\}[\s\S]*?size="icon-xs"/)
  assert.match(runDrawer, /<Badge variant="secondary">\{t\('run\.timeline'\)\}<\/Badge>/)
  assert.match(publications, /className="m-2"[\s\S]*?size="lg"[\s\S]*?variant="outline"/)
  assert.match(publications, /<Badge variant="secondary">\{t\('publication\.current'\)\}<\/Badge>/)
  assert.match(diagnostics, /<Badge variant="secondary">\{scopeLabel\(item\.scope, t\)\}<\/Badge>/)
  assert.doesNotMatch(workspaceStyles, /\.diagnostics-(?:empty|loading)/)
  assert.doesNotMatch(workspaceStyles, /\.run-input-error/)
  assert.doesNotMatch(workspaceStyles, /\.workspace-title button|\.validation-state:(?:hover|focus)|\.validation-state\.(?:invalid|active)/)
  assert.doesNotMatch(workspaceStyles, /\.diagnostic-scope/)
  assert.doesNotMatch(workspaceStyles, /\[data-slot='tabs-trigger'\]/)
  assert.doesNotMatch(canvasStyles, /\.designer-overlay\.top-right > \[data-slot='button'\]/)
  assert.doesNotMatch(canvasStyles, /\.designer-delete-action/)
  assert.doesNotMatch(canvasStyles, /\.canvas-empty-recommendations \[data-slot='button'\]/)
  assert.doesNotMatch(contextPanelStyles, /\.block-library-search/)
  assert.doesNotMatch(contextPanelStyles, /oo-designer-picker/)
  assert.doesNotMatch(contextPanelStyles, /\.block-library \[data-slot='button'\]:hover/)
  assert.doesNotMatch(contextPanelStyles, /\.inspector-form input:not/)
  assert.doesNotMatch(runStyles, /\.run-list-item\.active|\.run-load-more/)
  assert.doesNotMatch(runStyles, /\.run-source|\.run-header strong/)
  assert.doesNotMatch(runStyles, /\.run-summary > \[data-slot='button'\]/)
  assert.doesNotMatch(runStyles, /\.event-locate \{[^}]*?(?:padding|border-radius|background|color):/)
  assert.doesNotMatch(publicationStyles, /\.publication-load-more/)
  assert.doesNotMatch(publicationStyles, /\.publication-current/)
  assert.doesNotMatch(responsiveStyles, /\.diagnostics-loading/)
  assert.doesNotMatch(responsiveStyles, /\.run-history-back/)
  const diagnosticRow = workspaceStyles.match(/\.diagnostic-row \{([^}]*)\}/)
  assert.ok(diagnosticRow)
  assert.doesNotMatch(diagnosticRow[1]!, /background:/)
  const inspectorTextarea = contextPanelStyles.match(/\.inspector-form textarea \{([^}]*)\}/)
  assert.ok(inspectorTextarea)
  assert.match(inspectorTextarea[1]!, /font-family: ui-monospace/)
  assert.doesNotMatch(inspectorTextarea[1]!, /border:|border-radius:|background:|padding:|color:/)
})

test('keeps Button icon sizing on the shared size variants', async () => {
  const paths: URL[] = []
  for await (const path of glob('src/workbench/browser/runtime/**/*.tsx', { cwd: packageRoot })) paths.push(new URL(path, packageRoot))
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  const buttonBodies = sources.flatMap((source) => [...source.matchAll(/<Button\b[\s\S]*?<\/Button>/g)].map((match) => match[0]))

  for (const body of buttonBodies) assert.doesNotMatch(body, /<Icon\b[^>]*\bsize=\{/)
})

test('keeps URL-changing Workbench navigation on real links', async () => {
  const [button, runtime, browser, header] = await Promise.all([
    readFile(new URL('src/ui/browser/button.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/openFlowWorkbench.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/resourceBrowser.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/workspaceHeader.tsx', packageRoot), 'utf8'),
  ])

  assert.match(runtime, /readonly hrefFor: \(location: WorkbenchLocation\) => string/)
  assert.match(button, /whitespace-nowrap no-underline/)
  assert.doesNotMatch(button, /hover:underline/)
  assert.match(browser, /render=\{<a href=/)
  assert.match(browser, /nativeButton=\{false\}/)
  assert.match(header, /render=\{<a href=\{flowsHref\}/)
  assert.match(header, /render=\{<a href=\{flowHref\}/)
  assert.doesNotMatch(header, /<Button[^>]*onClick=\{onOpenFlow/)
})

test('keeps responsive control density on component APIs', async () => {
  const [button, tabs, workspaceHeader, responsiveStyles, runStyles] = await Promise.all([
    readFile(new URL('src/ui/browser/button.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/ui/browser/tabs.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/workspaceHeader.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/responsive.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/runs.css', packageRoot), 'utf8'),
  ])

  assert.match(button, /data-size=\{size\}/)
  assert.match(button, /data-variant=\{variant\}/)
  assert.match(tabs, /motion-reduce:transition-none/)
  assert.match(tabs, /motion-reduce:after:transition-none/)
  assert.match(workspaceHeader, /className="validation-state"[\s\S]*?size="default"/)
  assert.match(workspaceHeader, /onClick=\{onRunDraft\}[\s\S]*?size="default"/)
  assert.match(workspaceHeader, /store\.publications\.publish\(\)[\s\S]*?size="default"/)
  assert.match(workspaceHeader, /className="action-help publish-action"/)
  assert.match(workspaceHeader, /className="workspace-tabs" variant="line"/)
  assert.doesNotMatch(responsiveStyles, /\.workspace-actions \[data-slot='button'\]/)
  assert.match(responsiveStyles, /\.workspace-actions \.publish-action\s*\{[\s\S]*?display: none;/)
  assert.doesNotMatch(responsiveStyles, /\.action-help:last-child/)
  assert.match(responsiveStyles, /@media \(pointer: coarse\)[\s\S]*?min-height: 40px;/)
  assert.match(responsiveStyles, /\[data-slot='button'\]\[data-size\^='icon'\][\s\S]*?min-width: 40px;/)
  assert.doesNotMatch(responsiveStyles, /\[data-slot='button'\] \{\s*height: 40px;/)
  assert.doesNotMatch(responsiveStyles, /\.workspace-tabs button/)
  assert.deepEqual(
    [...responsiveStyles.matchAll(/@container open-flow-workbench \(width <= (\d+)px\)/g)].map((match) => Number(match[1])),
    [1100, 980, 720, 520],
  )
  assert.doesNotMatch(responsiveStyles, /@media \(max-width:|legacy viewport|must win/)
  assert.doesNotMatch(runStyles, /@media \(max-width:/)
  assert.match(runStyles, /\.run-log-event/)
  assert.doesNotMatch(responsiveStyles, /\.run-log-event/)
})

test('keeps Workbench feedback on semantic theme surfaces', async () => {
  const [runOutput, tokens, runStyles, contextPanelStyles, statusStyles, responsiveStyles] = await Promise.all([
    readFile(new URL('src/workbench/browser/runtime/runs/runOutput.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/tokens.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/runs.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/context-panel.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/status.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/responsive.css', packageRoot), 'utf8'),
  ])

  for (const token of ['--warning-surface', '--warning-border', '--warning-foreground', '--danger-surface', '--danger-border', '--danger-foreground']) {
    assert.match(tokens, new RegExp(`${token}:`))
  }
  assert.match(runOutput, /Alert, AlertDescription, AlertTitle/)
  assert.equal((runOutput.match(/<Alert/g) ?? []).length, 6)
  assert.doesNotMatch(runOutput, /run-terminal-error/)
  assert.doesNotMatch(runStyles, /#fffbeb|#fef2f2|#991b1b|run-terminal-error/)
  assert.doesNotMatch(contextPanelStyles, /#fef2f2|#991b1b|#fffbeb|#92400e|#b45309|#fed7aa|#fff7ed|#9a3412|#b91c1c/)
  assert.doesNotMatch(statusStyles, /#a1a1aa/)
  assert.doesNotMatch(responsiveStyles, /#fef2f2|#fecaca/)
  const darkJson = runStyles.match(/&\[data-theme='dark'\] \.run-json \{([\s\S]*?)\}/)?.[1]
  assert.ok(darkJson)
  for (const color of Object.values(declarations(darkJson, '--json-'))) {
    assert.match(color, /^#[\da-f]{6}$/i)
    assert.ok(contrastRatio(color, '#1b1b1b') >= 4.5)
    assert.ok(contrastRatio(color, '#222222') >= 4.5)
  }
})

test('keeps responsive overlays aligned with the Workbench container and keyboard state', async () => {
  const [contextPanel, contextPanelBehavior, diagnostics, runInput, workspaceStyles, contextPanelStyles, responsiveStyles] = await Promise.all([
    readFile(new URL('src/workbench/browser/runtime/designer/contextPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/designer/contextPanelBehavior.ts', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/shell/diagnosticsPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/runs/runInputPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/workspace.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/context-panel.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/responsive.css', packageRoot), 'utf8'),
  ])

  assert.match(contextPanel, /closest<HTMLElement>\('\.open-flow-workbench'\)/)
  assert.match(contextPanel, /observeContextPanelOverlay\(root, setOverlay\)/)
  assert.match(contextPanelBehavior, /new ResizeObserverConstructor/)
  assert.match(contextPanelBehavior, /ownerDocument\.defaultView\?\.ResizeObserver/)
  assert.doesNotMatch(contextPanel, /matchMedia\('\(max-width: 980px\)'\)/)
  assert.match(diagnostics, /aria-busy=\{checking\}/)
  assert.match(diagnostics, /<span aria-live="polite">/)
  assert.match(runInput, /aria-busy=\{starting\}/)
  assert.match(workspaceStyles, /\.diagnostics-panel:focus-visible,[\s\S]*?outline: 2px solid var\(--ui-ring\)/)
  assert.match(workspaceStyles, /overscroll-behavior: contain/)
  assert.match(contextPanelStyles, /\.context-panel:focus-visible[\s\S]*?outline: 2px solid var\(--ui-ring\)/)
  assert.match(contextPanelStyles, /overscroll-behavior: contain/)
  assert.match(responsiveStyles, /max-height: 100dvh/)
  assert.match(workspaceStyles, /grid-template-rows: 52px minmax\(0, 1fr\)/)
  assert.match(workspaceStyles, /\.diagnostics-panel \{[\s\S]*?top: 52px;/)
  assert.match(workspaceStyles, /\.run-input-panel \{[\s\S]*?top: 52px;/)
  for (const side of ['top', 'right', 'bottom', 'left']) assert.match(responsiveStyles, new RegExp(`padding-${side}: env\\(safe-area-inset-${side}\\)`))
})

test('keeps repeated feature selectors consolidated at their owner', async () => {
  const [canvasStyles, runStyles] = await Promise.all([
    readFile(new URL('src/workbench/browser/runtime/styles/canvas.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/runs.css', packageRoot), 'utf8'),
  ])

  assert.equal((canvasStyles.match(/  \.canvas-empty \{/g) ?? []).length, 1)
  assert.equal((runStyles.match(/  \.run-log-event \{/g) ?? []).length, 1)
})

test('keeps Run input values on the WorkbenchRunInputs public contract', async () => {
  const [runInputs, editorStore] = await Promise.all([
    readFile(new URL('src/workbench/browser/runInputs.ts', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/flowRunInputEditorStore.ts', packageRoot), 'utf8'),
  ])

  assert.match(runInputs, /public readonly inputValues\$: ReadonlyVal/)
  assert.match(editorStore, /get\(inputs\.inputValues\$\)/)
  assert.doesNotMatch(editorStore, /handleInputsFrom!/)
})

test('keeps the Run input editor on the product theme adapter', async () => {
  const [editor, editorStyles, panel, workspace] = await Promise.all([
    readFile(new URL('src/workbench/browser/flowRunInputEditor.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/flowRunInputEditor.module.scss', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/runs/runInputPanel.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/flowWorkspace.tsx', packageRoot), 'utf8'),
  ])

  assert.match(editor, /data-workbench-control-scope/)
  assert.match(editor, /<ThemeProvider dark=\{theme == 'dark'\}/)
  assert.doesNotMatch(editor, /designerThemeClass/)
  assert.match(editorStyles, /--widget-height: 32px/)
  assert.match(editorStyles, /--widget-radius: var\(--ui-radius\)/)
  assert.match(editorStyles, /--widget-background: var\(--ui-background\)/)
  assert.doesNotMatch(editorStyles, /var\(--(?:border-[12]|text-[1-5])\)/)
  assert.match(panel, /<FlowRunInputEditor store=\{group\.editor\} theme=\{theme\}/)
  assert.match(workspace, /<RunInputPanel onStarted=\{revealRun\} store=\{store\.runRequests\} theme=\{theme\}/)
})

test('uses React Flow ownership for canvas chrome without custom toolbar primitives', async () => {
  const [displayMode, displayModeStyles, bottomRight, workbenchDesigner, button, buttonGroup, canvasStyles, reactFlow, reactFlowStyles, designerMixins] =
    await Promise.all([
      readFile(new URL('src/designer/browser/graph/ReactFlowContainer/DisplayModeToggle.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/designer/browser/graph/ReactFlowContainer/DisplayModeToggle.module.scss', packageRoot), 'utf8'),
      readFile(new URL('src/designer/browser/graph/ReactFlowContainer/BottomRight.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/workbench/browser/runtime/designer/workbenchDesigner.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/ui/browser/button.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/ui/browser/button-group.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/workbench/browser/runtime/styles/canvas.css', packageRoot), 'utf8'),
      readFile(new URL('src/designer/browser/graph/ReactFlowContainer/ReactFlowContainer.tsx', packageRoot), 'utf8'),
      readFile(new URL('src/designer/browser/graph/ReactFlowContainer/ReactFlowContainer.scss', packageRoot), 'utf8'),
      readFile(new URL('src/designer/browser/styles/_mixins.scss', packageRoot), 'utf8'),
    ])

  assert.match(displayMode, /import \{ Panel \} from '@xyflow\/react'/)
  assert.match(displayMode, /ToggleGroup/)
  assert.match(displayMode, /size="default"/)
  assert.doesNotMatch(displayMode, /Tabs|CanvasControl/)
  assert.match(bottomRight, /ControlButton, Controls, MiniMap as RFMiniMap/)
  assert.match(bottomRight, /position="bottom-right"/)
  assert.match(bottomRight, /title=\{modeBtnTitle\}/)
  assert.match(bottomRight, /buttonGroupVariants/)
  assert.match(bottomRight, /buttonGroupVariants\(\{ orientation: 'horizontal' \}\)/)
  assert.match(bottomRight, /orientation="horizontal"/)
  assert.doesNotMatch(bottomRight, /data-orientation=|data-slot="button-group"/)
  assert.match(bottomRight, /buttonVariants\(\{ size: 'icon', variant: 'outline' \}\)/)
  assert.doesNotMatch(bottomRight, /CanvasControl|DesignerTooltip/)
  assert.match(workbenchDesigner, /ui\/browser\/badge\.tsx/)
  assert.match(workbenchDesigner, /<Badge className="designer-overlay top-left" variant="secondary">/)
  assert.doesNotMatch(workbenchDesigner, /designer\/browser\/styles\/(?:dark|light)\.module\.scss|CanvasControl/)
  assert.doesNotMatch(displayModeStyles, /border:|border-radius:|background:|box-shadow:|color:|font-size:|font-weight:/)
  assert.doesNotMatch(canvasStyles, /--canvas-control-|\.designer-draft-status/)
  assert.match(buttonGroup, /vertical:[\s\S]*?rounded-b-none[\s\S]*?rounded-t-none[\s\S]*?border-t-0/)
  assert.match(reactFlow, /buttonGroupVariants\(\{ orientation: 'vertical' \}\)/)
  assert.match(reactFlow, /orientation="vertical"/)
  assert.match(reactFlow, /buttonVariants\(\{ size: 'icon', variant: 'outline' \}\)/)
  assert.match(reactFlow, /data-slot="button"/)
  assert.doesNotMatch(reactFlow, /data-orientation=|data-slot="button-group"/)
  assert.match(reactFlowStyles, /react-flow__controls\.horizontal[\s\S]*?flex-direction: row !important/)
  assert.match(reactFlowStyles, /:is\(\.horizontal, \.vertical\)[\s\S]*?data-slot='button'[\s\S]*?border-radius: 0 !important/)
  assert.match(
    reactFlowStyles,
    /:is\(\.horizontal, \.vertical\)[\s\S]*?width: var\(--canvas-control-container-size\) !important[\s\S]*?height: var\(--canvas-control-container-size\) !important/,
  )
  assert.match(
    reactFlowStyles,
    /react-flow__controls\.vertical[\s\S]*?not\(:last-child\)[\s\S]*?border-bottom-color: color-mix\(in srgb, var\(--ui-border\) 55%, transparent\) !important/,
  )
  assert.match(
    reactFlowStyles,
    /react-flow__controls\.horizontal[\s\S]*?not\(:last-child\)[\s\S]*?border-right-color: color-mix\(in srgb, var\(--ui-border\) 55%, transparent\) !important/,
  )
  assert.match(reactFlowStyles, /react-flow__controls\.vertical[\s\S]*?first-child[\s\S]*?border-top-left-radius:[\s\S]*?border-top-right-radius:/)
  assert.match(reactFlowStyles, /react-flow__controls\.vertical[\s\S]*?last-child[\s\S]*?border-bottom-right-radius:[\s\S]*?border-bottom-left-radius:/)
  assert.match(reactFlowStyles, /react-flow__controls\.horizontal[\s\S]*?first-child[\s\S]*?border-top-left-radius:[\s\S]*?border-bottom-left-radius:/)
  assert.match(reactFlowStyles, /react-flow__controls\.horizontal[\s\S]*?last-child[\s\S]*?border-top-right-radius:[\s\S]*?border-bottom-right-radius:/)
  assert.doesNotMatch(reactFlowStyles, /react-flow__controls-button[^}]*border-radius:/)
  assert.doesNotMatch(reactFlowStyles, /react-flow__controls-button[^}]*border-radius: 0/)
  assert.match(designerMixins, /--canvas-control-container-size: 32px/)
  assert.doesNotMatch(designerMixins, /--canvas-control-size:|--canvas-control-padding:/)
  assert.match(button, /forwardRef<HTMLButtonElement/)
})

test('keeps concrete Designer theme modules behind the Designer theme adapter', async () => {
  const workbenchSources: string[] = []
  for await (const path of glob('src/workbench/browser/**/*.{ts,tsx}', { cwd: packageRoot })) {
    workbenchSources.push(await readFile(new URL(path, packageRoot), 'utf8'))
  }
  const adapter = await readFile(new URL('src/designer/browser/theme/designerThemeClass.ts', packageRoot), 'utf8')

  assert.doesNotMatch(workbenchSources.join('\n'), /designer\/browser\/styles\/(?:dark|light)\.module\.scss/)
  assert.doesNotMatch(workbenchSources.join('\n'), /designerThemeClass/)
  assert.match(adapter, /styles\/dark\.module\.scss/)
  assert.match(adapter, /styles\/light\.module\.scss/)
})

test('maps canvas chrome through React Flow theme variables', async () => {
  const themes = await Promise.all([
    readFile(new URL('src/designer/browser/styles/light.module.scss', packageRoot), 'utf8'),
    readFile(new URL('src/designer/browser/styles/dark.module.scss', packageRoot), 'utf8'),
  ])

  for (const theme of themes) {
    assert.match(theme, /--xy-controls-button-background-color: var\(--ui-background\)/)
    assert.match(theme, /--xy-controls-button-border-color: var\(--ui-border\)/)
    assert.match(theme, /--xy-minimap-background-color: var\(--node-background-color\)/)
    assert.doesNotMatch(theme, /--rf-(?:controls|button|minimap)/)
  }
})

test('keeps the product theme contract separate from the Designer theme', async () => {
  const uiPaths: URL[] = []
  for await (const path of glob('src/ui/browser/**/*.{ts,tsx,css}', { cwd: packageRoot })) uiPaths.push(new URL(path, packageRoot))
  const [uiSources, productTheme, workbench, light, dark, workbenchRoot, reactFlowStyles] = await Promise.all([
    Promise.all(uiPaths.map((path) => readFile(path, 'utf8'))),
    readFile(new URL('src/ui/browser/theme.css', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/styles/tokens.css', packageRoot), 'utf8'),
    readFile(new URL('src/designer/browser/styles/light.module.scss', packageRoot), 'utf8'),
    readFile(new URL('src/designer/browser/styles/dark.module.scss', packageRoot), 'utf8'),
    readFile(new URL('src/workbench/browser/runtime/openFlowWorkbench.tsx', packageRoot), 'utf8'),
    readFile(new URL('src/designer/browser/graph/ReactFlowContainer/ReactFlowContainer.scss', packageRoot), 'utf8'),
  ])

  assert.deepEqual(referencedTokens(uiSources.join('\n'), '--ui-'), sharedUiTokens)
  assert.deepEqual(Object.keys(declarations(productTheme, '--ui-')).toSorted(), sharedUiTokens)
  for (const [owner, source] of Object.entries({ light, dark })) {
    assert.deepEqual(Object.keys(declarations(source, '--ui-')).toSorted(), sharedUiTokens, `${owner} does not implement the shared UI token contract.`)
  }
  assert.match(productTheme, /\.open-flow-theme\s*\{[\s\S]*?--open-flow-background: #ffffff;/)
  assert.match(productTheme, /\.open-flow-theme\[data-theme='dark'\]/)
  assert.match(productTheme, /--ui-background: var\(--open-flow-background\);/)
  assert.match(productTheme, /--open-flow-radius: 8px;/)
  assert.doesNotMatch(uiSources.join('\n'), /var\(--radius-(?:sm|md|lg)\)/)
  for (const theme of [light, dark]) assert.match(theme, /--ui-radius: 6px;/)
  assert.doesNotMatch(workbench, /--ui-[\w-]+\s*:/)
  assert.doesNotMatch(workbench, /--(?:canvas|surface|subtle|border|input|text|muted|primary|primary-foreground|focus|danger):/)
  assert.match(workbenchRoot, /className="open-flow-theme open-flow-workbench"/)
  assert.match(reactFlowStyles, /:where\(\.react-flow__controls, \[data-canvas-control-scope\]\)/)
  assert.match(reactFlowStyles, /--ui-background: var\(--open-flow-background, var\(--fill-1\)\);/)
  assert.doesNotMatch(reactFlowStyles, /\.oo-designer-root\s*\{\s*--ui-background:/)
})

test('keeps Workbench feature styles on the shared semantic theme', async () => {
  const sources: string[] = []
  for await (const path of glob('src/workbench/browser/runtime/styles/*.css', { cwd: packageRoot })) {
    sources.push(await readFile(new URL(path, packageRoot), 'utf8'))
  }

  assert.doesNotMatch(
    sources.join('\n'),
    /var\(--(?:canvas|surface|subtle|border|input|text|text-secondary|text-tertiary|muted|primary|primary-foreground|focus|danger)\)/,
  )
  assert.doesNotMatch(sources.join('\n'), /calc\(var\(--ui-radius\)/)
  assert.doesNotMatch(sources.join('\n'), /!important/)
})

test('keeps React Flow canvas chrome on one theme mapping', async () => {
  const themes = await Promise.all([
    readFile(new URL('src/designer/browser/styles/light.module.scss', packageRoot), 'utf8'),
    readFile(new URL('src/designer/browser/styles/dark.module.scss', packageRoot), 'utf8'),
  ])

  for (const theme of themes) {
    assert.deepEqual(declarations(theme, '--xy-'), reactFlowThemeContract)
    assert.doesNotMatch(theme, /--rf-/)
  }
})
