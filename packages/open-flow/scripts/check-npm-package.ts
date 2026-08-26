import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { unpackTar } from 'modern-tar'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const traverse = ((traverseModule as unknown as { readonly default?: typeof traverseModule }).default ?? traverseModule) as typeof traverseModule
const rootPath = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(path.join(rootPath, 'package.json'), 'utf8')) as { version: string }
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
  'package/dist/browser/workbench.css',
  'package/dist/browser/workbench.css.d.ts',
  'package/dist/browser/workbench.d.ts',
  'package/dist/browser/workbench.js',
  'package/dist/common/connector-action.d.ts',
  'package/dist/common/connector-action.js',
  'package/dist/common/connector-proxy.d.ts',
  'package/dist/common/connector-proxy.js',
  'package/dist/common/control-api.d.ts',
  'package/dist/common/control-api.js',
  'package/dist/common/control-api-conformance.d.ts',
  'package/dist/common/control-api-conformance.js',
  'package/dist/common/control-api-errors.d.ts',
  'package/dist/common/cron-trigger.d.ts',
  'package/dist/common/cron-trigger.js',
  'package/dist/common/integration-trigger.d.ts',
  'package/dist/common/integration-trigger.js',
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
  './workbench.css': {
    default: './dist/browser/workbench.css',
    types: './dist/browser/workbench.css.d.ts',
  },
})
for (const forbidden of ['bin', 'dependencies', 'devDependencies', 'main', 'module', 'scripts']) {
  assert.equal(Object.hasOwn(packedManifest, forbidden), false)
}

const workbenchEntry = entries.find((entry) => entry.header.name == 'package/dist/browser/workbench.js')
assert.ok(workbenchEntry?.data)
const workbenchSource = new TextDecoder().decode(workbenchEntry.data)
assert.match(workbenchSource, /from ['"]react['"]/)
assert.match(workbenchSource, /from ['"]react\/jsx-runtime['"]/)
const workspaceChunks = entryNames.filter((name) => /^package\/dist\/browser\/flowWorkspace-[A-Za-z\d_-]+\.js$/.test(name))
assert.equal(workspaceChunks.length, 1)
assert.match(workbenchSource, /import\(['"]\.\/flowWorkspace-[A-Za-z\d_-]+\.js['"]\)/)
const resourceDialogChunks = entryNames.filter((name) => /^package\/dist\/browser\/createResourceDialog-[A-Za-z\d_-]+\.js$/.test(name))
assert.equal(resourceDialogChunks.length, 1)
assert.ok(
  entries.some(
    (entry) =>
      entry.header.name.endsWith('.js') &&
      entry.data != null &&
      /import\(['"]\.\/createResourceDialog-[A-Za-z\d_-]+\.js['"]\)/.test(new TextDecoder().decode(entry.data)),
  ),
)
const workbenchStyleEntry = entries.find((entry) => entry.header.name == 'package/dist/browser/workbench.css')
assert.ok(workbenchStyleEntry?.data)
const workbenchStyle = new TextDecoder().decode(workbenchStyleEntry.data)
assert.match(workbenchStyle, /:where\(\.open-flow-workbench,\.oo-designer-root\) \.hidden\{display:none\}/)
assert.match(workbenchStyle, /\.sm\\:w-56\{[^}]*width:/)
assert.ok(workbenchStyle.includes('.i-custom\\:mouse{'))
assert.ok(workbenchStyle.includes('.bg-popover{background-color:var(--ui-popover)}'))
assert.ok(workbenchStyle.includes('.bg-card{background-color:var(--ui-card)}'))
assert.ok(workbenchStyle.includes('data-open\\:animate-in'))
assert.ok(workbenchStyle.includes('aria-current\\:bg-muted'))
assert.match(workbenchStyle, /\.justify-start\\!\{[^}]*justify-content:flex-start!important/)
assert.match(workbenchStyle, /\.mb-\\\[2px\\\]\{[^}]*margin-bottom:2px/)
for (const token of sharedUiTokens) assert.ok(workbenchStyle.includes(`${token}:`), `Missing ${token} from the published Workbench CSS.`)
const themeStyleEntry = entries.find((entry) => entry.header.name == 'package/dist/browser/theme.css')
assert.ok(themeStyleEntry?.data)
const themeStyle = new TextDecoder().decode(themeStyleEntry.data)
assert.match(themeStyle, /\.open-flow-theme\s*\{/)
assert.match(themeStyle, /\.open-flow-theme\[data-theme='dark'\]/)
for (const token of sharedUiTokens) assert.ok(themeStyle.includes(`${token}:`), `Missing ${token} from the published product theme CSS.`)
assert.doesNotMatch(workbenchStyle, /--rf-/)
assert.doesNotMatch(workbenchStyle, /(?:font-size-4|mb-2px|\\!justify-start|bg-dark)/)
assert.doesNotMatch(workbenchStyle, /(?:^|[{},])\.hidden\{display:none\}/)
assert.doesNotMatch(workbenchStyle, /data:font\//)
const referencedFonts = [...workbenchStyle.matchAll(/url\((\.\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf))\)/g)]
  .map((match) => `package/dist/browser/${match[1]!.slice(2)}`)
  .toSorted()
assert.ok(referencedFonts.length > 0)
assert.deepEqual(
  entryNames.filter((name) => /^package\/dist\/browser\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf)$/.test(name)),
  referencedFonts,
)
const workbenchJavaScript = entries.filter(
  (entry) => entry.header.name.startsWith('package/dist/browser/') && entry.header.name.endsWith('.js') && entry.data != null,
)
assert.ok(workbenchJavaScript.some((entry) => /from ['"]react-dom['"]/.test(new TextDecoder().decode(entry.data!))))
for (const entry of workbenchJavaScript) {
  assertNoReactRequire(new TextDecoder().decode(entry.data!), entry.header.name)
}

await Promise.all(
  [
    { react: '18.3.1', reactDomTypes: '18.3.1', reactTypes: '18.3.12' },
    { react: '19.2.0', reactDomTypes: '19.2.3', reactTypes: '19.2.2' },
  ].map(verifyConsumer),
)

for (const sourcePath of ['src/designer/browser/scriptletTemplates/typescript.txt']) {
  const source = await readFile(path.join(rootPath, sourcePath), 'utf8')
  assert.equal(hasRuntimePackageImport(source, sourcePath), false, `${sourcePath} imports the package at runtime.`)
}

console.log('Verified the public npm package contract, Browser runtime exports, and React 18/19 consumers.')

async function verifyConsumer(versions: { readonly react: string; readonly reactDomTypes: string; readonly reactTypes: string }): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), `open-flow-react-${versions.react.split('.')[0]}-`))
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: {
            '@oomol-lab/open-flow': `file:${tarballPath}`,
            'effect': '4.0.0-rc.112',
            'react': versions.react,
            'react-dom': versions.react,
          },
          devDependencies: {
            '@types/react': versions.reactTypes,
            '@types/react-dom': versions.reactDomTypes,
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
        "import { maximumPollEventsPerPage } from '@oomol-lab/open-flow/poll-trigger'",
        "import { triggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'",
        "import { createValue } from '@oomol-lab/open-flow/flow-authoring'",
        "import type { Task } from '@oomol-lab/open-flow'",
        "import { encodeRevision } from '@oomol-lab/open-flow/flow-encoding'",
        "import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'",
        "import { transitionRun } from '@oomol-lab/open-flow/run-lifecycle'",
        "import { createEventProjector } from '@oomol-lab/open-flow/run-events'",
        "import type { RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'",
        "import { runtimeConformanceCases } from '@oomol-lab/open-flow/runtime-contract'",
        "import { runFlow } from '@oomol-lab/open-flow/scheduler'",
        "import { webhookEndpointId } from '@oomol-lab/open-flow/webhook-trigger'",
        "import type { WorkbenchHost, WorkbenchLocation } from '@oomol-lab/open-flow/workbench'",
        "import { OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'",
        "import { createElement } from 'react'",
        "import '@oomol-lab/open-flow/workbench.css'",
        "import '@oomol-lab/open-flow/theme.css'",
        'const connector: ConnectorProxy = { execute: async () => ({ data: {}, status: 200 }) }',
        "const connectorAction: ConnectorAction = { actionId: 'mail.send', description: '', inputs: {}, name: 'send', outputs: {}, serviceId: 'mail', serviceName: 'Mail' }",
        "const controlError: ControlErrorCode = 'flow.not-found'",
        "const transition = transitionRun('queued', { kind: 'claim' })",
        "const runtimeProgram: RuntimeProgram = { engineContract: 'open-flow-engine/v1', engineDigest: 'sha256:test', entryModuleId: 'main', modules: {} }",
        "const location: WorkbenchLocation = { view: 'design' }",
        'const host: WorkbenchHost = {',
        '  notify: () => undefined, openExternalPage: async () => false,',
        '  request: async () => Response.json({}), subscribeFlow: () => () => undefined, subscribeFlowCatalog: () => () => undefined,',
        '}',
        "const workbench = createElement(OpenFlowWorkbench, { host, hrefFor: () => '/teams/team-a', language: 'en', location, onNavigate: () => undefined,",
        "  preferences: { getItem: () => null, setItem: () => undefined }, sessionKey: 'team-a', theme: 'light' })",
        'const task: Task<{ value: string }, { value: string }> = async (inputs) => inputs',
        'void connector',
        'void connectorAction',
        'void connectorActionPorts',
        'void controlError',
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
        'void prepareFlow',
        'void transition',
        'void runtimeProgram',
        'void runtimeConformanceCases',
        'void createEventProjector',
        'void runFlow',
        'void webhookEndpointId',
        'void workbench',
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
    await execFileAsync(
      process.execPath,
      [
        '-e',
        "const action = await import('@oomol-lab/open-flow/connector-action'); if (typeof action.connectorActionPorts !== 'function') throw new Error('Missing Connector Action contract.')",
      ],
      { cwd: directory },
    )
    await execFileAsync(
      process.execPath,
      [
        '-e',
        "const Effect = await import('effect/Effect'); const { runFlow } = await import('@oomol-lab/open-flow/scheduler'); const result = await Effect.runPromise(runFlow({ closureDigest: 'consumer', engineContract: 'open-flow-engine/v1', graph: { nodes: {} }, modules: {}, subflows: {}, tasks: {} }, { createId: () => 'consumer-job', flowId: 'main', invokeTask: () => Effect.fail(new Error('Unexpected Task invocation.')), runId: 'consumer-run' })); if (result.kind !== 'node-results' || result.nodes.length !== 0) throw new Error('Scheduler Effect is not interoperable with the consumer Effect runtime.')",
      ],
      { cwd: directory },
    )
    await execFileAsync(
      process.execPath,
      [
        '-e',
        "const api = await import('@oomol-lab/open-flow/control-api'); if (typeof api.ControlClient !== 'function') throw new Error('Missing Control API client.'); if (api.controlErrorMetadata[api.controlErrorCode.runNotFound].status !== 404) throw new Error('Missing Control API errors.'); const proxy = await import('@oomol-lab/open-flow/connector-proxy'); if (Object.keys(proxy).length !== 0) throw new Error('Connector Proxy should be type-only.'); const control = await import('@oomol-lab/open-flow/control-api-conformance'); if (control.controlApiConformanceCases.length !== 5 || control.publicationControlApiConformanceCases.length !== 2 || control.triggerControlApiConformanceCases.length !== 2 || control.connectorControlApiConformanceCases.length !== 2) throw new Error('Missing Control API conformance.'); const cron = await import('@oomol-lab/open-flow/cron-trigger'); if (typeof cron.nextTriggerScheduledAt !== 'function') throw new Error('Missing Cron Trigger contract.'); const integration = await import('@oomol-lab/open-flow/integration-trigger'); if (integration.integrationConformanceCases.length === 0) throw new Error('Missing Integration Trigger contract.'); const poll = await import('@oomol-lab/open-flow/poll-trigger'); if (poll.maximumPollEventsPerPage !== 100) throw new Error('Missing Poll Trigger contract.'); const providers = await import('@oomol-lab/open-flow/provider-triggers'); if (providers.triggerDefinitions.length !== 17) throw new Error('Missing Provider Trigger definitions.'); const slack = providers.triggerDefinitions.find((definition) => definition.snapshot.key === 'slack.on_message_posted'); if (slack == null || !('poll' in slack)) throw new Error('Missing Slack Trigger definition.'); let sharedPollError = false; try { await slack.poll({ checkpoint: null, config: { channelId: 'C1' }, connector: { execute: async () => ({ data: { error: 'invalid_auth', ok: false }, status: 200 }) }, now: new Date() }) } catch (error) { sharedPollError = error instanceof poll.PollConnectionError } if (!sharedPollError) throw new Error('Provider Trigger does not share the Poll error identity.'); const lifecycle = await import('@oomol-lab/open-flow/run-lifecycle'); if (lifecycle.transitionRun('queued', { kind: 'claim' }).kind !== 'ready') throw new Error('Missing Run lifecycle runtime.'); const events = await import('@oomol-lab/open-flow/run-events'); if (typeof events.createEventProjector !== 'function') throw new Error('Missing Run event projection.'); const runtime = await import('@oomol-lab/open-flow/runtime-contract'); if (runtime.runtimeConformanceCases.length === 0) throw new Error('Missing Runtime contract.'); const scheduler = await import('@oomol-lab/open-flow/scheduler'); if (typeof scheduler.runFlow !== 'function') throw new Error('Missing Scheduler runtime.'); const webhook = await import('@oomol-lab/open-flow/webhook-trigger'); if (webhook.maximumWebhookBodyBytes !== 65536) throw new Error('Missing Webhook Trigger contract.'); const encoding = await import('@oomol-lab/open-flow/flow-encoding'); if (typeof encoding.encodeRevision !== 'function') throw new Error('Missing Flow encoding runtime.'); const semantics = await import('@oomol-lab/open-flow/flow-semantics'); if (typeof semantics.prepareFlow !== 'function') throw new Error('Missing Flow semantics runtime.'); const workbench = await import('@oomol-lab/open-flow/workbench'); if (typeof workbench.OpenFlowWorkbench !== 'function') throw new Error('Missing Workbench runtime.'); await import.meta.resolve('@oomol-lab/open-flow/workbench.css'); await import.meta.resolve('@oomol-lab/open-flow/theme.css')",
      ],
      { cwd: directory },
    )
    await assert.rejects(
      execFileAsync(process.execPath, ['-e', "await import('@oomol-lab/open-flow')"], { cwd: directory }),
      (error: unknown) => error instanceof Error && error.message.includes("Cannot find module '@oomol-lab/open-flow'"),
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function hasRuntimePackageImport(source: string, sourcePath: string): boolean {
  const program = parse(source, { plugins: ['typescript'], sourceFilename: sourcePath, sourceType: 'module' }).program
  return program.body.some((statement) => {
    if (statement.type != 'ImportDeclaration' || statement.source.value != '@oomol-lab/open-flow') return false
    if (statement.importKind == 'type') return false
    if (statement.specifiers.length == 0) return true
    return statement.specifiers.some((specifier) => specifier.type != 'ImportSpecifier' || specifier.importKind != 'type')
  })
}

function assertNoReactRequire(source: string, sourcePath: string): void {
  const ast = parse(source, { sourceFilename: sourcePath, sourceType: 'module' })
  const requireNames = new Set<string>()
  for (const statement of ast.program.body) {
    if (statement.type != 'ImportDeclaration' || !/^\.\/rolldown-runtime-.+\.js$/.test(statement.source.value)) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type == 'ImportSpecifier' && specifier.imported.type == 'Identifier' && specifier.imported.name == 'r') {
        requireNames.add(specifier.local.name)
      }
    }
  }
  traverse(ast, {
    CallExpression(call) {
      if (call.node.callee.type != 'Identifier' || !requireNames.has(call.node.callee.name)) return
      const [moduleId] = call.node.arguments
      assert.equal(
        moduleId?.type == 'StringLiteral' && /^react(?:-dom)?(?:\/.*)?$/.test(moduleId.value),
        false,
        `${sourcePath} calls the Rolldown runtime require helper for React.`,
      )
    },
  })
}
