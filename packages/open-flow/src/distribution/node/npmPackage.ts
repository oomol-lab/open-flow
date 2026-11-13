import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import sourceManifest from '../../../package.json' with { type: 'json' }

const sourceEntries = Object.entries(sourceManifest.exports).filter(
  ([, target]) => target.startsWith('./src/') && !target.includes('/browser/') && !target.includes('/node/'),
)

interface StageNpmPackageOptions {
  readonly packageRoot: string
  readonly sourceRoot: string
  readonly version: string
}

export async function stageNpmPackage(options: StageNpmPackageOptions): Promise<void> {
  const { packageRoot, sourceRoot, version } = options
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
  await Promise.all([
    stageSources(options),
    cp(path.join(sourceRoot, 'skills'), path.join(packageRoot, 'skills'), { recursive: true }),
    copyFile(path.join(sourceRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE')),
    copyFile(path.join(sourceRoot, 'NOTICE'), path.join(packageRoot, 'NOTICE')),
    writeFile(path.join(packageRoot, 'README.md'), renderReadme()),
    writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(createManifest(version), undefined, 2)}\n`),
  ])
}

async function stageSources({ packageRoot, sourceRoot }: StageNpmPackageOptions): Promise<void> {
  const compiler = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc')
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      compiler,
      '--ignoreConfig',
      '--listFilesOnly',
      '--noEmit',
      '--module',
      'preserve',
      '--moduleResolution',
      'bundler',
      '--target',
      'esnext',
      '--resolveJsonModule',
      '--allowImportingTsExtensions',
      '--types',
      'node',
      path.join(sourceRoot, 'src/types/index.ts'),
      ...sourceEntries.map(([, target]) => path.join(sourceRoot, target)),
    ],
    { cwd: sourceRoot, maxBuffer: 10 * 1024 * 1024 },
  )
  const sources = stdout
    .trim()
    .split(/\r?\n/)
    .filter((file) => file.startsWith(path.join(sourceRoot, 'src') + path.sep))
  await Promise.all(
    sources.map(async (file) => {
      const target = path.join(packageRoot, path.relative(sourceRoot, file))
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(file, target)
    }),
  )
}

function createManifest(version: string): object {
  return {
    name: '@oomol-lab/open-flow',
    version,
    description: 'TypeScript contracts and Browser runtime for Open Flow.',
    license: 'SEE LICENSE IN LICENSE',
    repository: {
      type: 'git',
      url: 'git+https://github.com/oomol-lab/open-flow.git',
      directory: 'packages/open-flow',
    },
    types: './dist/index.d.ts',
    exports: {
      './command': { types: './dist/command/index.d.ts', import: './dist/command/index.js' },
      './package.json': './package.json',
      './skills/open-flow/SKILL.md': './skills/open-flow/SKILL.md',
      './skills/open-flow/references/flow-authoring.md': './skills/open-flow/references/flow-authoring.md',
      './skills/open-flow/references/flow-n8n-conversion.md': './skills/open-flow/references/flow-n8n-conversion.md',

      '.': {
        types: './dist/index.d.ts',
      },
      './decision': { types: './dist/common/decision.d.ts', import: './dist/common/decision.js' },
      './provider-icons': { types: './dist/common/provider-icons.d.ts', import: './dist/common/provider-icons.js' },
      './flow-state': { types: './dist/common/flow-state.d.ts', import: './dist/common/flow-state.js' },
      './http-request': { types: './dist/common/http-request.d.ts', import: './dist/common/http-request.js' },
      './openapi': { types: './dist/common/openapi.d.ts', import: './dist/common/openapi.js' },
      './workflow': { types: './dist/common/workflow.d.ts', import: './dist/common/workflow.js' },
      './connector-action': {
        types: './dist/common/connector-action.d.ts',
        import: './dist/common/connector-action.js',
      },
      './connector-proxy': {
        types: './dist/common/connector-proxy.d.ts',
        import: './dist/common/connector-proxy.js',
      },
      './mcp': { types: './dist/common/mcp.d.ts', import: './dist/common/mcp.js' },
      './control-requests': { types: './dist/common/control-requests.d.ts', import: './dist/common/control-requests.js' },
      './control-api': {
        types: './dist/common/control-api.d.ts',
        import: './dist/common/control-api.js',
      },
      './control-api-conformance': {
        types: './dist/common/control-api-conformance.d.ts',
        import: './dist/common/control-api-conformance.js',
      },
      './cron-trigger': {
        types: './dist/common/cron-trigger.d.ts',
        import: './dist/common/cron-trigger.js',
      },
      './event-source': { types: './dist/common/event-source.d.ts', import: './dist/common/event-source.js' },
      './integration-trigger': {
        types: './dist/common/integration-trigger.d.ts',
        import: './dist/common/integration-trigger.js',
      },
      './localization': {
        types: './dist/common/localization.d.ts',
        import: './dist/common/localization.js',
      },
      './poll-trigger': {
        types: './dist/common/poll-trigger.d.ts',
        import: './dist/common/poll-trigger.js',
      },
      './provider-triggers': {
        types: './dist/common/provider-triggers.d.ts',
        import: './dist/common/provider-triggers.js',
      },
      './flow-authoring': {
        types: './dist/common/flow-authoring.d.ts',
        import: './dist/common/flow-authoring.js',
      },
      './flow-change': {
        types: './dist/common/flow-change.d.ts',
        import: './dist/common/flow-change.js',
      },
      './flow-encoding': {
        types: './dist/common/flow-encoding.d.ts',
        import: './dist/common/flow-encoding.js',
      },
      './flow-semantics': {
        types: './dist/common/flow-semantics.d.ts',
        import: './dist/common/flow-semantics.js',
      },
      './run-lifecycle': {
        types: './dist/common/run-lifecycle.d.ts',
        import: './dist/common/run-lifecycle.js',
      },
      './run-events': {
        types: './dist/common/run-events.d.ts',
        import: './dist/common/run-events.js',
      },
      './runtime-contract': {
        types: './dist/common/runtime-contract.d.ts',
        import: './dist/common/runtime-contract.js',
      },
      './runtime-nodejs-compat': {
        types: './dist/common/runtime-nodejs-compat.d.ts',
        import: './dist/common/runtime-nodejs-compat.js',
      },
      './scheduler': {
        types: './dist/common/scheduler.d.ts',
        import: './dist/common/scheduler.js',
      },
      './webhook-trigger': {
        types: './dist/common/webhook-trigger.d.ts',
        import: './dist/common/webhook-trigger.js',
      },
      './workbench-host-conformance': { types: './dist/browser/host-conformance.d.ts', import: './dist/browser/host-conformance.js' },
      './preview': { types: './dist/browser/preview.d.ts', import: './dist/browser/preview.js' },
      './preview.css': { types: './dist/browser/preview.css.d.ts', default: './dist/browser/preview.css' },
      './render': { types: './dist/render/node/index.d.ts', import: './dist/render/node/index.js' },
      './workbench': {
        types: './dist/browser/workbench.d.ts',
        import: './dist/browser/workbench.js',
      },
      './ui': { types: './dist/browser/ui.d.ts', import: './dist/browser/ui.js' },
      './ui.css': { types: './dist/browser/ui.css.d.ts', default: './dist/browser/ui.css' },
      './workbench.css': {
        types: './dist/browser/workbench.css.d.ts',
        default: './dist/browser/workbench.css',
      },
      './theme.css': {
        types: './dist/browser/theme.css.d.ts',
        default: './dist/browser/theme.css',
      },
    },
    files: ['dist', 'src', 'skills', 'README.md', 'NOTICE', 'LICENSE'],
    peerDependencies: {
      'effect': '4.0.0-rc.112',
      'zod': '^4.6.5',
      'react': '^18.3.1 || ^19.0.0',
      'react-dom': '^18.3.1 || ^19.0.0',
      'playwright-core': sourceManifest.peerDependencies['playwright-core'],
    },
    peerDependenciesMeta: { 'playwright-core': sourceManifest.peerDependenciesMeta['playwright-core'] },
    sideEffects: ['**/*.css'],
    publishConfig: {
      access: 'public',
      provenance: true,
      registry: 'https://registry.npmjs.org/',
    },
  }
}

function renderReadme(): string {
  return `# @oomol-lab/open-flow

TypeScript contracts and Browser runtime for Open Flow.

The offline Publications viewer is available as \`OpenFlowPreview\` from
\`@oomol-lab/open-flow/preview\`, with standalone \`@oomol-lab/open-flow/preview.css\`.
Supply \`draft\`, \`presentation\` (or null), \`language\` and \`theme\`; the entry also exports
\`Draft\`, \`Presentation\` and \`OpenFlowPreviewProps\` types. Give its parent an explicit height.
It supports temporary node movement, restore layout, read-only properties without
fetching or saving a workflow. Use a new React key to reset the session when switching examples.
Provider artwork and names load through the resource-cache App Catalog singleton. Hosts using the
same singleton share catalog requests, freshness and validation; no Provider prop is required.
A Shadow DOM host must load the stylesheet inside its shadow root before mounting the component;
Vite hosts can import \`@oomol-lab/open-flow/preview.css?url\` for the stylesheet URL.

## Node PNG rendering

On Node.js 20+, install the optional \`playwright-core\` peer and supply your own
Chromium Browser. Prepare the browser executable, its system libraries and required
Chinese fonts yourself. The renderer reuses the Workbench PNG implementation and
ships its own rendering resources; it does not require a running Workbench service.

\`\`\`ts
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { flowToPng } from '@oomol-lab/open-flow/render'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH })
try {
  const workflow = JSON.parse(await readFile('workflow.openflow.json', 'utf8'))
  const result = await flowToPng(browser, workflow, { language: 'zh-CN', dark: true, frame: true })
  await writeFile('workflow.png', result.buffer)
} finally {
  await browser.close()
}
\`\`\`

Pass a parsed \`.openflow.json\` object. Options default to English, light mode and
no frame; \`title\` overrides the file name shown in the frame. The result also
provides \`width\`, \`height\` and \`hasImagePlaceholders\`. Image scale and allocation
retries adapt automatically. Each call closes its own Context, leaving your Browser
available for reuse. It validates the file without modifying it or executing nodes.

Network access is allowed by default, including requests to private endpoints.
Set \`allowNetwork: false\` when rendering untrusted files to block requests in the
renderer's Context. Bundled rendering resources remain available. The exporter sets
\`hasImagePlaceholders\` to \`true\` when it substitutes an image placeholder. Remote
node icons may instead use a component fallback or be omitted without setting this
flag. A \`false\` value does not guarantee that every remote image loaded.

For Provider artwork, pass the same \`ControlClient\` used by offline authoring as
\`client\`. The renderer reuses its Provider JSON cache; without a client it keeps
bundled fallback icons and does not request a public catalog.

\`\`\`ts
import { ProviderIconCache } from '@oomol-lab/open-flow/provider-icons'

const iconCache = new ProviderIconCache({ scope, delegate, mode: 'default' })
const result = await flowToPng(browser, workflow, { client, iconCache })
\`\`\`

The storage delegate implements \`get(key)\`, \`set(key, json)\` and \`delete(key)\`,
matching \`ControlCacheDelegate\`. Reuse the icon cache across exports. It uses a
separate namespace for complete image responses with binary bodies. Each scope has
two fixed sprite slots, light and dark, and one original-image slot per Provider.
URL and sprite version must match before reuse. Successfully loaded versions replace
their slot; failed loads never combine old artwork with new crop coordinates.
Original images use HTTP caching and ETag, with a 24-hour default; \`no-store\` is
respected. Options include \`mode: 'refresh' | 'offline' | 'default'\` and \`fetch\`.
Without a delegate, the cache uses memory. Storage failures retain successful loads
in memory. \`allowNetwork: false\` reads both Provider JSON and artwork caches only,
and blocks remote requests in the temporary browser Context. Missing artwork falls
back without failing the export.

Browser Workbench and Preview store Blobs in IndexedDB and share short Blob URLs.
The \`getBlob\` method reads binary artwork; the published \`get\` data-URL method
remains available for existing hosts. A \`storage\` delegate accepts opaque Blob
records; a JSON \`delegate\` stores byte arrays and reads earlier cache records.

Browser Workbench and Preview cache Provider artwork in IndexedDB by default. Supply
\`host.iconCache\` or the Preview's \`iconCache\` prop to replace it. Workbench PNG
export uses the same cache. Iconify and Markdown images keep their existing behavior.

Install the Task contracts as a development dependency:

\`\`\`bash
bun add --dev @oomol-lab/open-flow
\`\`\`

Hosted products can use the controlled Workbench runtime:

\`\`\`ts
import { OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import '@oomol-lab/open-flow/workbench.css'
\`\`\`

Hosts can render \`OpenFlowSessionGate\` before authentication to keep login, retry, pending, and error states on the same shared shadcn composition as the Workbench.

Deployment chrome can import \`@oomol-lab/open-flow/theme.css\` and apply \`open-flow-theme\` plus \`data-theme\` to its root.

Embed the CLI in a Bun host through the explicit command subpath:

\`\`\`ts
import { runOpenFlowCommand, type OpenFlowCommandHost } from '@oomol-lab/open-flow/command'

const exitCode = await runOpenFlowCommand(args, { cloudRequest, getWorkbenchUrl, language: 'en' })
\`\`\`

Pass arguments after the host's \`oo flow\` prefix. The host supplies authenticated
Control API requests and Workbench URLs, and handles the returned exit code.
The command uses process stdin/stdout/stderr and targets Bun 1.4.2 or newer.
Importing it does not execute the CLI. Bundle it into the host at build time;
runtime dependencies and the package version are included in the command entry.
Skill templates ship in this same package under \`skills/open-flow/\`.

## Public implementation sources

The package includes the original sources for its platform-neutral public entries and their
local dependencies under \`src/\`, matching this package version. Browser UI sources are excluded.
These files are for reading implementation logic; import the public package entries as usual.
Source paths are not public import APIs. Source maps and declaration maps are not included.

| Public entry | Source |
| --- | --- |
| \`@oomol-lab/open-flow\` (types) | [src/types/index.ts](src/types/index.ts) |
${sourceEntries.map(([entry, target]) => `| \`@oomol-lab/open-flow/${entry.slice(2)}\` | [${target.slice(2)}](${target.slice(2)}) |`).join('\n')}

## License

[Open Flow License](LICENSE), based on Apache-2.0 with additional conditions.
See [NOTICE](NOTICE) for third-party notices.
`
}
