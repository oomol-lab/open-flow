# Open Flow

Open Flow defines portable workflow semantics, Control API conformance, and shared Browser runtime.
Hosted deployments and Server provide independent implementations for the same product contracts.
The public Open Flow repository is the only editable source of these contracts, conformance assets,
deterministic runtime semantics, and the product-neutral Workbench runtime. Private deployments
consume versioned package artifacts and must not keep synchronized source copies.

> [!IMPORTANT]
> Open Flow is under active development and has not reached its first public release.

Install the package from npm:

```bash
bun add @oomol-lab/open-flow
```

Hosts embed the Workbench runtime and styles from the same versioned artifact:

```ts
import { OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import '@oomol-lab/open-flow/workbench.css'
```

Deployment chrome that needs the same light and dark semantic palette without the Workbench styles
can import `@oomol-lab/open-flow/theme.css` and apply `open-flow-theme` plus `data-theme` to its root.

Open Flow clients operate Flows through one selected Control API deployment and do not create,
scan or execute local workflow directories. The concrete Isolated VM host belongs to Server and
is not exported by this package.

[Read the repository documentation](../../docs/README.md).

## Node PNG rendering

On Node.js 20+, import `flowToPng` from `@oomol-lab/open-flow/render` and pass a
parsed `.openflow.json` object and your Chromium Browser. Install the optional
`playwright-core` peer dependency and prepare Chromium, its system libraries and any
required Chinese fonts yourself.

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { flowToPng } from '@oomol-lab/open-flow/render'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH })
try {
  const workflow = JSON.parse(await readFile('workflow.openflow.json', 'utf8'))
  const result = await flowToPng(browser, workflow, { language: 'zh-CN', dark: true, frame: true, layout: 'compact', aspectRatio: '4:3' })
  await writeFile('workflow.png', result.buffer)
} finally {
  await browser.close()
}
```

The result also includes `width`, `height` and `hasImagePlaceholders`. Options default
to English, light mode and no frame; `title` overrides the file name shown in a frame.
Layout defaults to `original`, preserving saved positions. Set `layout: 'compact'`
to bend long vertical dependency paths toward the sides. Each run follows the workflow's
direction, with a U-shaped return between runs. Branches start near their fork; shared
joins follow all incoming runs. Vertical nodes retain top inputs and bottom outputs,
while horizontal workflows always preserve their saved layout. Compact layout preserves node sizes and branch order and does not change
the input file.
Disconnected subgraphs wrap as complete units into rows sized for the canvas ratio,
including their connection paths, comments and isolated nodes. Roots sharing a descendant remain in one subgraph.
Set `aspectRatio` to `1:1`, `4:3`, `3:4`, `16:9` or `9:16` to choose the ratio of the
complete PNG, including its frame. The exporter centers the content with extra canvas
space and uses the chosen ratio when arranging compact vertical workflows. It never
crops or stretches nodes. Omit the option or use `auto` to fit the content bounds.
Pixels outside the rounded frame are transparent; the canvas inside follows the chosen theme.
Image scale and allocation retries follow the Workbench PNG exporter automatically.
The function validates the file without changing it or executing nodes, and closes
its own Context after each call. You own the Browser lifecycle. Rendering resources
ship with the package; no Workbench server is needed. In a source checkout, build
the package before using the Node renderer.

Network access is allowed by default, including requests to private endpoints.
Set `allowNetwork: false` when rendering untrusted files to block requests in the
renderer's Context. Bundled rendering resources remain available. The exporter sets
`hasImagePlaceholders` to `true` when it substitutes an image placeholder. Remote
node icons may instead use a component fallback or be omitted without setting this
flag. A `false` value does not guarantee that every remote image loaded.

### Provider artwork and offline caches

Pass the same `ControlClient` used by `createWorkflowAuthoring` to render Provider
names and artwork. Without a client, the renderer uses bundled fallback icons and
does not request a public catalog. Provider JSON keeps the client's existing cache
scope, TTL and ETag behavior. `allowNetwork: false` reads that catalog cache only.

```ts
import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { ProviderIconCache } from '@oomol-lab/open-flow/provider-icons'

// The host supplies opaque JSON storage through get/set/delete.
const client = new ControlClient(request, 'api', {
  cache: { scope, delegate, mode: 'default' },
})
const iconCache = new ProviderIconCache({ scope, delegate })
const result = await flowToPng(browser, workflow, { client, iconCache })
const offline = await flowToPng(browser, workflow, {
  client,
  iconCache,
  allowNetwork: false,
})
```

Reuse the icon cache across exports. It stores complete image responses separately
from JSON, with base64 bodies. Each scope has two fixed sprite slots, one per theme,
and one original-image slot per Provider. Reads require the exact source URL and
sprite version; updated artwork replaces its slot only after a successful download.
Old sprite bytes are never combined with another version's crop coordinates.
Matching versioned sprites are immutable; originals use HTTP cache headers and ETag,
with a 24-hour default when no freshness is supplied. `no-store` images are not retained.
The optional `mode` is `default`, `refresh` or `offline`; `fetch` can replace the image
transport. A cache without a delegate uses memory. Storage failures retain successful
loads in memory, and failed requests may be retried. Missing artwork falls back without
making the export fail. Offline reads never start or join a network load.

Browser Workbench and Preview use IndexedDB for Provider artwork by default, falling
back to memory when storage is unavailable. To supply a cache, set `host.iconCache`
on `OpenFlowWorkbench` or `iconCache` on `OpenFlowPreview`. Workbench PNG export uses
the same cache. Iconify icons and Markdown images keep their existing loading behavior.

## Host themes

The host selects light/dark mode through the `theme` prop. Open Flow does not read a host's
`.dark` class or unprefixed theme variables. Configure its palette with optional `--open-flow-*`
CSS inputs on a **host-owned ancestor** of the Workbench or Preview:

```css
.workflow-host {
  --open-flow-background: var(--background);
  --open-flow-foreground: var(--foreground);
  --open-flow-card: var(--card);
  --open-flow-card-foreground: var(--card-foreground);
  --open-flow-popover: var(--popover);
  --open-flow-popover-foreground: var(--popover-foreground);
  --open-flow-primary: var(--primary);
  --open-flow-primary-foreground: var(--primary-foreground);
  --open-flow-secondary: var(--secondary);
  --open-flow-secondary-foreground: var(--secondary-foreground);
  --open-flow-muted: var(--muted);
  --open-flow-muted-foreground: var(--muted-foreground);
  --open-flow-accent: var(--accent);
  --open-flow-accent-foreground: var(--accent-foreground);
  --open-flow-destructive: var(--destructive);
  --open-flow-border: var(--border);
  --open-flow-input: var(--input);
  --open-flow-control-background: var(--background);
  --open-flow-ring: var(--ring);
  --open-flow-radius: var(--radius);
  --open-flow-node-surface: var(--muted);
  --open-flow-node-content: var(--card);
  --open-flow-canvas-background: var(--background);
  --open-flow-canvas-grid: color-mix(in srgb, var(--foreground) 10%, transparent);
}
```

```tsx
<div className="workflow-host">
  <OpenFlowWorkbench {...props} theme={resolvedTheme} />
</div>
```

Every input is optional. Each theme root resolves omitted inputs to its own light/dark defaults;
nested roots retain explicit host inputs, and sibling host containers can supply independent palettes.
The stylesheet uses native `color-scheme`, `light-dark()` and
[custom-property style queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_size_and_style_queries)
so dark control variants follow the nearest theme root too. Browsers must support these CSS features.
Inputs are configuration, not computed output tokens. Shared controls consume `--ui-*` internally;
hosts must not override those tokens or internal component selectors to theme the product.
Map host aliases on the ancestor so they resolve before entering Open Flow's canvas namespace.
No CSS import order or selector-specificity override is required for ancestor inputs.

The semantic palette covers product controls, canvas text, neutral surfaces, borders and selection.
Canvas background and grid are independently configurable with `--open-flow-canvas-background`
and `--open-flow-canvas-grid`; `--open-flow-canvas-lock-stripe` configures read-only stripes.
Node shells and content use `--open-flow-node-surface` and `--open-flow-node-content`.
`--open-flow-control-background` independently sets form control backgrounds, including search
fields, text inputs, textareas and selects in Workbench, property panels and canvas editors.
It does not change node or panel surfaces. Omit it to retain each control's default surface;
`--open-flow-input` continues to configure input borders.
Optional `--open-flow-comment-surface`, `--open-flow-comment-content` and
`--open-flow-comment-border` configure comments; `--open-flow-node-running-beam` configures
the running outline. Unconfigured comments and execution colors retain the product defaults.
Compact node geometry, control density, execution states, edge types and syntax colors remain
product-owned. A host's base radius does not replace the canvas's compact node geometry.

## License

[Open Flow License](LICENSE)

## Open an import confirmation

Hosts load external files and open the Flow list before calling the Workbench ref. Open Flow parses
the text and uses the same confirmation dialog as local file imports. It does not fetch the source URL.

```tsx
import { useRef } from 'react'
import { OpenFlowWorkbench, type OpenFlowWorkbenchHandle, type OpenFlowWorkbenchProps } from '@oomol-lab/open-flow/workbench'

function Host(props: OpenFlowWorkbenchProps) {
  const workbenchRef = useRef<OpenFlowWorkbenchHandle>(null)

  async function openDownloadedFile(file: File) {
    const text = await file.text()
    const result = workbenchRef.current?.openImport({
      text,
      fileName: file.name,
      description: <span>Local file: {file.name}</span>,
    })
    // Handle an unavailable Workbench in the host; this call is never queued.
    return result
  }

  return (
    <>
      <input
        type="file"
        accept=".openflow.json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file != null) void openDownloadedFile(file)
        }}
      />
      <OpenFlowWorkbench ref={workbenchRef} {...props} />
    </>
  )
}
```

`openImport({ text, fileName?, description? })` returns `opened` when confirmation opens,
`invalid-file` when parsing fails (reported through `host.notify`), or `unavailable` when the
Workbench is not on an initialized Flow list, is busy, or already has a creation/import dialog open.
`opened` does not mean a Flow has been created. The optional `description` accepts a `ReactNode`
rendered below the dialog title. The host owns its content, link behavior, and styling; Open Flow
does not parse or fetch source URLs. Replace previous `sourceUrl` arguments with host-rendered
links in `description`. The file's name takes precedence over `fileName`, with a localized fallback
when neither exists.

Cancel creates nothing. Confirmation uses the existing `importFlow` callback, or the deployment's
Control API when no callback is supplied, and opens the new unpublished draft after success.
The host owns download errors, login recovery, navigation, and processing a share link once.
Do not cache handles across session changes; an old session's handle returns `unavailable`.

## Event source management

`EventSourcesPage` from `@oomol-lab/open-flow/workbench` requires a `notify` callback with the
same notification contract as `WorkbenchHost.notify`. Pass the host's notification handler to
show operation failures. Field validation, unavailable configuration and loading failures remain
within their related controls; failed saves preserve the form for retry.

## Offline workflow preview

`@oomol-lab/open-flow/preview` exports the same read-only viewer used in Publications,
without its striped canvas background. It includes temporary node movement, layout direction switching,
layout restoration and properties. It does not fetch a publication, save changes, or execute a flow.

```tsx
import { OpenFlowPreview, type Draft, type Presentation } from '@oomol-lab/open-flow/preview'
import '@oomol-lab/open-flow/preview.css'

function Example({ draft, presentation }: { draft: Draft; presentation: Presentation | null }) {
  return (
    <div style={{ height: 640 }}>
      <OpenFlowPreview draft={draft} presentation={presentation} language="en" theme="light" defaultInteractiveMode="mouse" defaultDirection="vertical" />
    </div>
  )
}
```

Supply a complete `Draft` (workflow document, task definitions and modules) and a `Presentation`
using the existing control API contracts. They can be constructed locally; no server or
`WorkbenchHost` is required. When no node coordinates are saved, including an absent (`null`)
presentation, the viewer measures the cards and applies the same layout used by the canvas's
rearrange action. Existing coordinates are preserved. These are workflow definitions, not React Flow nodes.

The preview has no title bar. Its optional `label` names the accessible region; layout restoration appears as canvas controls when needed.

`defaultInteractiveMode` accepts `mouse` or `touchpad` and defaults to `touchpad`.
`defaultDirection` accepts `horizontal` or `vertical`; omit it to keep the presentation's direction
(horizontal when no direction is saved). A different initial direction runs the canvas's measured
layout, including comments. Users can change these settings through the canvas controls.
The entry also exports their `InteractiveMode` and `CanvasDirection` types.

| Prop                     | Default | Behavior                                                                                                         |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `defaultMiniMapExpanded` | `false` | Initially expands the mini map. Users can toggle it in the canvas controls.                                      |
| `defaultInspectorOpen`   | `false` | Initially opens the property panel. Users can close or reopen it.                                                |
| `defaultSelectedNodeIds` | `[]`    | Initially selects workflow nodes or comments by ID. Missing IDs are ignored; duplicate IDs select the node once. |
| `nodesDraggable`         | `true`  | Allows temporary node movement. Selection, inspection and direction switching remain available when disabled.    |
| `dottedBackground`       | `true`  | Shows the canvas dot grid.                                                                                       |
| `layoutMotion`           | `true`  | Animates layout changes while respecting reduced-motion preferences.                                             |

All `default*` props apply only when the preview mounts. Changing them leaves the current session
unchanged. `nodesDraggable`, `dottedBackground` and `layoutMotion` update immediately without resetting
temporary layout or selection.

Combine `defaultSelectedNodeIds={["node-id"]}` with `defaultInspectorOpen` to initially show that
node's properties. Multiple IDs show the selection in the property panel's node list. These IDs
are workflow node or presentation comment IDs, without React Flow's internal prefixes.

The host owns container dimensions, language and light/dark theme. Theme and language can change
without resetting temporary node positions or layout direction. Layout changes never write back to the supplied objects.
Restore layout returns both direction and positions to the supplied presentation while preserving the current viewport.
Without saved coordinates, it restores the first automatically generated layout.
Use a new React `key` when switching examples or applying new defaults to reset the session.

For Shadow DOM, the host creates the shadow root and mounts the React component inside it.
Load **preview.css inside that root**, for example with a `<link rel="stylesheet">` pointing to
its bundled URL. Vite/Astro hosts can obtain that URL with
`import previewCssUrl from '@oomol-lab/open-flow/preview.css?url'`.
Wait for the stylesheet to load before mounting the viewer so initial node measurements use
its styles. Preserve the emitted CSS asset references when deploying. Importing the CSS into the
outer document alone does not style a shadow tree. No Shadow DOM container or sample workflow is
shipped in the public component; Lab has normal and shadow-hosted verification examples.

The Lab [publication fixture](dev/designer/publicationFixture.ts) is a complete locally constructed
example with a trigger, values, a code task, approval and comments.

The full inspector retains its existing lazy code/language and icon resources. Load the homepage
island on demand when integrating it into a static site, and measure the host's final production
bundle including the resources used by its example workflow.
