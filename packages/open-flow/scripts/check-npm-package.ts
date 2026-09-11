import { unpackTar } from 'modern-tar'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const rootPath = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(path.join(rootPath, 'package.json'), 'utf8')) as { version: string; devDependencies: Record<string, string> }
const tarballPath = path.join(rootPath, 'dist/release', `oomol-lab-open-flow-${manifest.version}.tgz`)
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

await execFileAsync(process.execPath, [path.join(rootPath, 'scripts/build.ts'), '--quiet'], { cwd: rootPath })
const entries = await unpackTar(gunzipSync(await readFile(tarballPath)), { strict: true })
const entryNames = entries.map((entry) => entry.header.name).toSorted()
for (const expected of [
  'package/LICENSE',
  'package/NOTICE',
  'package/README.md',
  'package/dist/browser/licenses.md',
  'package/dist/browser/flow-authoring-edge.d.ts',
  'package/dist/browser/flow-authoring-module.d.ts',
  'package/dist/browser/flow-authoring-node.d.ts',
  'package/dist/browser/flow-authoring.d.ts',
  'package/dist/browser/flow-authoring.js',
  'package/dist/browser/flow-notifications.d.ts',
  'package/dist/browser/flow-change.d.ts',
  'package/dist/browser/flow-change.js',
  'package/dist/browser/workbench-contract.d.ts',
  'package/dist/browser/theme.css',
  'package/dist/browser/theme.css.d.ts',
  'package/dist/browser/ui.js',
  'package/dist/browser/ui.d.ts',
  'package/dist/browser/ui-input.d.ts',
  'package/dist/browser/ui-label.d.ts',
  'package/dist/browser/ui-textarea.d.ts',
  'package/dist/browser/ui.css',
  'package/dist/browser/ui.css.d.ts',
  'package/dist/browser/workbench.css',
  'package/dist/browser/workbench.css.d.ts',
  'package/dist/browser/workbench.d.ts',
  'package/dist/browser/workbench.js',
  'package/dist/common/connector-action.d.ts',
  'package/dist/common/connector-action.js',
  'package/dist/common/connector-proxy.d.ts',
  'package/dist/common/connector-proxy.js',
  'package/dist/common/mcp.d.ts',
  'package/dist/common/mcp.js',
  'package/dist/common/mcp-conformance.d.ts',
  'package/dist/common/control-requests.d.ts',
  'package/dist/common/control-requests.js',
  'package/dist/browser/host-conformance.d.ts',
  'package/dist/browser/host-conformance.js',
  'package/dist/common/control-api.d.ts',
  'package/dist/common/control-api.js',
  'package/dist/common/control-api-conformance.d.ts',
  'package/dist/common/control-api-conformance.js',
  'package/dist/common/control-api-errors.d.ts',
  'package/dist/common/cron-trigger.d.ts',
  'package/dist/common/cron-trigger.js',
  'package/dist/common/integration-trigger.d.ts',
  'package/dist/common/integration-trigger.js',
  'package/dist/common/localization.d.ts',
  'package/dist/common/localization.js',
  'package/dist/common/poll-trigger.d.ts',
  'package/dist/common/poll-trigger.js',
  'package/dist/common/provider-triggers.d.ts',
  'package/dist/common/provider-triggers.js',
  'package/dist/common/run-lifecycle.d.ts',
  'package/dist/common/run-lifecycle.js',
  'package/dist/common/run-events.d.ts',
  'package/dist/common/run-events.js',
  'package/dist/common/engine-contract.d.ts',
  'package/dist/common/flow-encoding.d.ts',
  'package/dist/common/flow-encoding.js',
  'package/dist/common/flow-notifications.d.ts',
  'package/dist/common/flow-graph.d.ts',
  'package/dist/common/flow-schema.d.ts',
  'package/dist/common/flow-modules.d.ts',
  'package/dist/common/flow-semantics.d.ts',
  'package/dist/common/flow-semantics.js',
  'package/dist/common/runtime-contract.d.ts',
  'package/dist/common/runtime-contract.js',
  'package/dist/common/scheduler.d.ts',
  'package/dist/common/scheduler.js',
  'package/dist/common/webhook-trigger.d.ts',
  'package/dist/common/webhook-trigger.js',
  'package/dist/index.d.ts',
  'package/package.json',
]) {
  assert.ok(entryNames.includes(expected), `Missing npm package entry ${expected}.`)
}
assert.equal(
  entryNames.some((name) => name.includes('/command/') || name.includes('/skills/') || name.includes('/src/')),
  false,
)
assert.equal(
  entryNames.some((name) => name.includes('isolated-vm-runtime')),
  false,
)
assert.equal(
  entryNames.every((name) => !name.startsWith('package/dist/browser/') || !name.endsWith('.map')),
  true,
)

const packedManifestEntry = entries.find((entry) => entry.header.name == 'package/package.json')
assert.ok(packedManifestEntry?.data)
const packedManifest = JSON.parse(new TextDecoder().decode(packedManifestEntry.data)) as Record<string, unknown>
assert.deepEqual(Object.keys(packedManifest).toSorted(), [
  'description',
  'exports',
  'files',
  'license',
  'name',
  'peerDependencies',
  'publishConfig',
  'repository',
  'sideEffects',
  'types',
  'version',
])
assert.deepEqual(packedManifest.peerDependencies, {
  'effect': '4.0.0-rc.112',
  'react': '^18.3.1 || ^19.0.0',
  'react-dom': '^18.3.1 || ^19.0.0',
})
assert.deepEqual(packedManifest.repository, {
  directory: 'packages/open-flow',
  type: 'git',
  url: 'git+https://github.com/oomol-lab/open-flow.git',
})
assert.deepEqual(packedManifest.exports, {
  '.': { types: './dist/index.d.ts' },
  './connector-action': {
    import: './dist/common/connector-action.js',
    types: './dist/common/connector-action.d.ts',
  },
  './connector-proxy': {
    import: './dist/common/connector-proxy.js',
    types: './dist/common/connector-proxy.d.ts',
  },
  './mcp': { import: './dist/common/mcp.js', types: './dist/common/mcp.d.ts' },
  './control-requests': { import: './dist/common/control-requests.js', types: './dist/common/control-requests.d.ts' },
  './workbench-host-conformance': { import: './dist/browser/host-conformance.js', types: './dist/browser/host-conformance.d.ts' },
  './control-api': {
    import: './dist/common/control-api.js',
    types: './dist/common/control-api.d.ts',
  },
  './control-api-conformance': {
    import: './dist/common/control-api-conformance.js',
    types: './dist/common/control-api-conformance.d.ts',
  },
  './cron-trigger': {
    import: './dist/common/cron-trigger.js',
    types: './dist/common/cron-trigger.d.ts',
  },
  './integration-trigger': {
    import: './dist/common/integration-trigger.js',
    types: './dist/common/integration-trigger.d.ts',
  },
  './localization': {
    import: './dist/common/localization.js',
    types: './dist/common/localization.d.ts',
  },
  './poll-trigger': {
    import: './dist/common/poll-trigger.js',
    types: './dist/common/poll-trigger.d.ts',
  },
  './provider-triggers': {
    import: './dist/common/provider-triggers.js',
    types: './dist/common/provider-triggers.d.ts',
  },
  './flow-authoring': {
    import: './dist/browser/flow-authoring.js',
    types: './dist/browser/flow-authoring.d.ts',
  },
  './flow-change': {
    import: './dist/browser/flow-change.js',
    types: './dist/browser/flow-change.d.ts',
  },
  './flow-encoding': {
    import: './dist/common/flow-encoding.js',
    types: './dist/common/flow-encoding.d.ts',
  },
  './flow-semantics': {
    import: './dist/common/flow-semantics.js',
    types: './dist/common/flow-semantics.d.ts',
  },
  './run-lifecycle': {
    import: './dist/common/run-lifecycle.js',
    types: './dist/common/run-lifecycle.d.ts',
  },
  './run-events': {
    import: './dist/common/run-events.js',
    types: './dist/common/run-events.d.ts',
  },
  './runtime-contract': {
    import: './dist/common/runtime-contract.js',
    types: './dist/common/runtime-contract.d.ts',
  },
  './scheduler': {
    import: './dist/common/scheduler.js',
    types: './dist/common/scheduler.d.ts',
  },
  './theme.css': {
    default: './dist/browser/theme.css',
    types: './dist/browser/theme.css.d.ts',
  },
  './webhook-trigger': {
    import: './dist/common/webhook-trigger.js',
    types: './dist/common/webhook-trigger.d.ts',
  },
  './workbench': {
    import: './dist/browser/workbench.js',
    types: './dist/browser/workbench.d.ts',
  },
  './ui': { types: './dist/browser/ui.d.ts', import: './dist/browser/ui.js' },
  './ui.css': { types: './dist/browser/ui.css.d.ts', default: './dist/browser/ui.css' },
  './workbench.css': {
    default: './dist/browser/workbench.css',
    types: './dist/browser/workbench.css.d.ts',
  },
})
for (const forbidden of ['bin', 'dependencies', 'devDependencies', 'main', 'module', 'scripts']) {
  assert.equal(Object.hasOwn(packedManifest, forbidden), false)
}

const workbenchStyleEntry = entries.find((entry) => entry.header.name == 'package/dist/browser/workbench.css')
assert.ok(workbenchStyleEntry?.data)
const workbenchStyle = new TextDecoder().decode(workbenchStyleEntry.data)
assert.match(workbenchStyle, /:where\([^)]*\.open-flow-workbench[^)]*\)\s+\.hidden\s*\{\s*display:\s*none\s*;?\s*\}/)
for (const token of sharedUiTokens) assert.ok(workbenchStyle.includes(`${token}:`), `Missing ${token} from the published Workbench CSS.`)
const themeStyleEntry = entries.find((entry) => entry.header.name == 'package/dist/browser/theme.css')
assert.ok(themeStyleEntry?.data)
const themeStyle = new TextDecoder().decode(themeStyleEntry.data)
assert.match(themeStyle, /\.open-flow-theme\s*\{/)
assert.match(themeStyle, /\.open-flow-theme\[data-theme='dark'\]/)
for (const token of sharedUiTokens) assert.ok(themeStyle.includes(`${token}:`), `Missing ${token} from the published product theme CSS.`)
assert.doesNotMatch(workbenchStyle, /(?:^|[{},])\s*\.hidden\s*\{\s*display:\s*none/)
assert.doesNotMatch(workbenchStyle, /data:font\//)
const referencedFonts = [...workbenchStyle.matchAll(/url\((\.\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf))\)/g)]
  .map((match) => `package/dist/browser/${match[1]!.slice(2)}`)
  .toSorted()
assert.ok(referencedFonts.length > 0)
assert.deepEqual(
  entryNames.filter((name) => /^package\/dist\/browser\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf)$/.test(name)),
  referencedFonts,
)
await verifyConsumer()

console.log('Verified the public npm package contract, Browser runtime exports, and package consumer.')

async function verifyConsumer(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: {
            '@oomol-lab/open-flow': `file:${tarballPath}`,
            'effect': manifest.devDependencies.effect,
            'react': manifest.devDependencies.react,
            'react-dom': manifest.devDependencies['react-dom'],
          },
          devDependencies: {
            '@types/react': manifest.devDependencies['@types/react'],
            '@types/react-dom': manifest.devDependencies['@types/react-dom'],
          },
          private: true,
          type: 'module',
        },
        undefined,
        2,
      )}\n`,
    )
    await execFileAsync(process.execPath, ['install', '--ignore-scripts'], { cwd: directory })
    const consumerPath = path.join(directory, 'consumer.tsx')
    await writeFile(
      consumerPath,
      [
        "import type { ConnectorAction, ControlErrorCode } from '@oomol-lab/open-flow/control-api'",
        "import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'",
        "import type { ConnectorProxy } from '@oomol-lab/open-flow/connector-proxy'",
        "import { connectorControlApiConformanceCases, controlApiConformanceCases, publicationControlApiConformanceCases, triggerControlApiConformanceCases } from '@oomol-lab/open-flow/control-api-conformance'",
        "import { validateTriggerSchedule } from '@oomol-lab/open-flow/cron-trigger'",
        "import { integrationConformanceCases } from '@oomol-lab/open-flow/integration-trigger'",
        "import type { UiLanguage } from '@oomol-lab/open-flow/localization'",
        "import { resolveUiLanguage } from '@oomol-lab/open-flow/localization'",
        "import { maximumPollEventsPerPage } from '@oomol-lab/open-flow/poll-trigger'",
        "import { triggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'",
        "import { createValue } from '@oomol-lab/open-flow/flow-authoring'",
        "import type { Task } from '@oomol-lab/open-flow'",
        "import { mcpTools } from '@oomol-lab/open-flow/mcp'",
        "import { controlRequests } from '@oomol-lab/open-flow/control-requests'",
        "import { verifyWorkbenchHost } from '@oomol-lab/open-flow/workbench-host-conformance'",
        "import { encodeRevision, decodeRevision, decodeRevisionContent } from '@oomol-lab/open-flow/flow-encoding'",
        "import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'",
        "import { transitionRun } from '@oomol-lab/open-flow/run-lifecycle'",
        "import { createEventProjector } from '@oomol-lab/open-flow/run-events'",
        "import type { RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'",
        "import { runtimeConformanceCases } from '@oomol-lab/open-flow/runtime-contract'",
        "import { runFlow } from '@oomol-lab/open-flow/scheduler'",
        "import { webhookEndpointId } from '@oomol-lab/open-flow/webhook-trigger'",
        "import type { WorkbenchHost, WorkbenchLocation } from '@oomol-lab/open-flow/workbench'",
        "import { OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'",
        "import { createElement } from 'react'",
        "import '@oomol-lab/open-flow/workbench.css'",
        "import { Button, Input, Label, Textarea } from '@oomol-lab/open-flow/ui'",
        "import '@oomol-lab/open-flow/ui.css'",
        'const hostFields = <><Label htmlFor="host-input">Name</Label><Input id="host-input" value="name" onChange={(event) => event.target.value} /><Textarea defaultValue="value" /><Button variant="outline" size="sm" type="submit">Save</Button></>',
        'void hostFields',
        "import '@oomol-lab/open-flow/theme.css'",
        'const connector: ConnectorProxy = { execute: async () => ({ data: {}, status: 200 }) }',
        "const connectorAction: ConnectorAction = { actionId: 'mail.send', authenticated: true, description: '', inputs: {}, name: 'send', outputs: {}, serviceId: 'mail', serviceName: 'Mail' }",
        "const controlError: ControlErrorCode = 'flow.not-found'",
        "const uiLanguage: UiLanguage = resolveUiLanguage(['fr-CA'])",
        "const transition = transitionRun('queued', { kind: 'claim' })",
        "const runtimeProgram: RuntimeProgram = { engineContract: 'open-flow-engine/v2', engineDigest: 'sha256:test', entryModuleId: 'main', modules: {} }",
        "const location: WorkbenchLocation = { view: 'design' }",
        'const host: WorkbenchHost = {',
        '  notify: () => undefined, openExternalPage: async () => false,',
        '  request: async () => Response.json({}), subscribeFlow: () => ({ ready: Promise.resolve(), stop() {} }), subscribeFlowCatalog: () => ({ ready: Promise.resolve(), stop() {} }),',
        '}',
        "const workbench = createElement(OpenFlowWorkbench, { host, hrefFor: () => '/teams/team-a', language: 'en', location, onNavigate: () => undefined,",
        "  preferences: { getItem: () => null, setItem: () => undefined }, sessionKey: 'team-a', theme: 'light', variables: false })",
        "const sessionGate = createElement(OpenFlowSessionGate, { action: 'Sign in', description: 'Use the operator token.', onSubmit: () => undefined, title: 'Open Flow', token: '', tokenLabel: 'Operator token' })",
        'const task: Task<{ value: string }, { value: string }> = async (inputs) => inputs',
        'void connector',
        'void connectorAction',
        'void connectorActionPorts',
        'void controlError',
        'void uiLanguage',
        'void connectorControlApiConformanceCases',
        'void controlApiConformanceCases',
        'void publicationControlApiConformanceCases',
        'void triggerControlApiConformanceCases',
        'void integrationConformanceCases',
        'void validateTriggerSchedule',
        'void maximumPollEventsPerPage',
        'void triggerDefinitions',
        'void createValue',
        'void encodeRevision',
        'void decodeRevision',
        'void decodeRevisionContent',
        'void verifyWorkbenchHost',
        "const argumentsResult = mcpTools.flow_get.inputSchema['~standard'].validate({flowId: 'test'})",
        "if ('value' in argumentsResult) { const flowId: string = argumentsResult.value.flowId; void flowId }",
        "const create = controlRequests.createFlow({ name: 'Test', version: 1 }); const name: string = create.name; void name",
        'void prepareFlow',
        'void transition',
        'void runtimeProgram',
        'void runtimeConformanceCases',
        'void createEventProjector',
        'void runFlow',
        'void webhookEndpointId',
        'void workbench',
        'void sessionGate',
        'void task',
        '',
      ].join('\n'),
    )
    const compiler = path.join(path.dirname(packageRequire.resolve('typescript/package.json')), 'bin/tsc')
    await execFileAsync(
      process.execPath,
      [
        compiler,
        '--ignoreConfig',
        '--noEmit',
        '--module',
        'preserve',
        '--moduleResolution',
        'bundler',
        '--target',
        'esnext',
        '--jsx',
        'react-jsx',
        '--strict',
        consumerPath,
      ],
      { cwd: directory },
    )
    const runtimePath = path.join(directory, 'consumer.mjs')
    await copyFile(path.join(rootPath, 'scripts/npm-package-consumer.mjs'), runtimePath)
    await execFileAsync(process.execPath, [runtimePath], { cwd: directory })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
