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
    const result = workbenchRef.current?.openImport({ text, fileName: file.name })
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

`openImport({ text, fileName?, sourceUrl? })` returns `opened` when confirmation opens,
`invalid-file` when parsing fails (reported through `host.notify`), or `unavailable` when the
Workbench is not on an initialized Flow list, is busy, or already has a creation/import dialog open.
`opened` does not mean a Flow has been created. The optional `sourceUrl` is displayed in the dialog;
only HTTP(S) URLs become links. The file's name takes precedence over `fileName`, with a localized
fallback when neither exists.

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
without its striped canvas background. It includes temporary node movement, layout restoration,
properties. It does not fetch a publication, save changes, or execute a flow.

```tsx
import { OpenFlowPreview, type Draft, type Presentation } from '@oomol-lab/open-flow/preview'
import '@oomol-lab/open-flow/preview.css'

function Example({ draft, presentation }: { draft: Draft; presentation: Presentation | null }) {
  return (
    <div style={{ height: 640 }}>
      <OpenFlowPreview draft={draft} presentation={presentation} language="en" theme="light" />
    </div>
  )
}
```

Supply a complete `Draft` (workflow document, task definitions and modules) and a `Presentation`
using the existing control API contracts. They can be constructed locally; no server or
`WorkbenchHost` is required. Pass `null` for an absent presentation to use the Publications viewer's
existing missing-layout behavior. These are workflow definitions, not React Flow nodes.

The preview has no title bar. Its optional `label` names the accessible region; layout restoration appears as canvas controls when needed.

The host owns container dimensions, language and light/dark theme. Theme and language can change
without resetting temporary node positions. Movement never writes back to the supplied objects.
Use a new React `key` when switching examples to reset selection and layout.

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
