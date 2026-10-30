import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { build, esmExternalRequirePlugin } from 'vite'
import { generateScopedName } from '../../build/node/cssModules.ts'
import designerUnoConfig from '../../build/node/designerUnoConfig.ts'
import { providerIconsPlugin } from '../../build/node/providerIcons.ts'
import { twemojiCollectionPlugin } from '../../build/node/twemojiCollection.ts'

const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const connectorActionEntryPath = 'src/connector/common/actionSchema.ts'
const connectorProxyEntryPath = 'src/connector/common/proxy.ts'
const controlRequestsEntryPath = 'src/control/common/requests.ts'
const mcpEntryPath = 'src/control/common/mcp.ts'
const controlApiEntryPath = 'src/control/common/api.ts'
const controlApiConformanceEntryPath = 'src/control/common/conformance.ts'
const controlApiErrorsEntryPath = 'src/control/common/errors.ts'
const flowNotificationsEntryPath = 'src/control/common/flowNotifications.ts'
const cronTriggerEntryPath = 'src/trigger/common/cron.ts'
const eventSourceEntryPath = 'src/event-source/common/index.ts'
const integrationTriggerEntryPath = 'src/trigger/common/integration.ts'
const pollTriggerEntryPath = 'src/trigger/common/poll.ts'
const providerTriggersEntryPath = 'src/trigger/providers/definitions.ts'
const flowAuthoringEntryPath = 'src/flow/common/authoring.ts'
const flowChangeEntryPath = 'src/flow/common/change.ts'
const flowEncodingEntryPath = 'src/flow/common/encoding.ts'
const flowSemanticsEntryPath = 'src/flow/common/semantics.ts'
const runLifecycleEntryPath = 'src/execution/common/runLifecycle.ts'
const runEventsEntryPath = 'src/execution/common/events.ts'
const runtimeContractEntryPath = 'src/runtime/common/runtime.ts'
const runtimeNodejsCompatEntryPath = 'src/runtime/common/nodejsCompat.ts'
const schedulerEntryPath = 'src/execution/common/scheduler.ts'
const webhookTriggerEntryPath = 'src/trigger/common/webhook.ts'
const localizationEntryPath = 'src/localization/common/languages.ts'
const hostConformanceEntryPath = 'src/workbench/browser/runtime/hostConformance.ts'
const uiEntryPath = 'src/distribution/browser/ui.ts'
const uiDeclarationEntryPath = 'src/ui/browser/public.ts'
const previewEntryPath = 'src/distribution/browser/preview.ts'
const previewDeclarationEntryPath = 'src/workbench/browser/runtime/openFlowPreview.tsx'
const workbenchEntryPath = 'src/distribution/browser/workbench.ts'
const workbenchDeclarationEntryPath = 'src/workbench/browser/runtime/openFlowWorkbench.tsx'

/** Published declaration paths under `dist/`, keyed by source path under `src/`. A source may publish into several directories. */
const declarationOutputs: readonly (readonly [source: string, output: string])[] = [
  ['canvas/common/commands', 'common/canvas-commands'],
  ['connector/common/actionSchema', 'common/connector-action'],
  ['connector/common/providerIconSprite', 'common/providerIconSprite'],
  ['connector/common/proxy', 'common/connector-proxy'],
  ['control/common/api', 'common/control-api'],
  ['control/common/authoring', 'common/authoring'],
  ['control/common/authoringExamples', 'common/authoringExamples'],
  ['control/common/authoringFields', 'common/authoringFields'],
  ['control/common/authoringSchema', 'common/authoringSchema'],
  ['control/common/conformance', 'common/control-api-conformance'],
  ['control/common/connectorDecoders', 'common/connectorDecoders'],
  ['control/common/draftOperations', 'common/draftOperations'],
  ['control/common/errors', 'common/control-api-errors'],
  ['control/common/eventSources', 'common/event-sources'],
  ['control/common/flowInspection', 'common/flowInspection'],
  ['control/common/flowNotifications', 'common/flow-notifications'],
  ['control/common/flowNotifications', 'browser/flow-notifications'],
  ['control/common/liveDetails', 'common/liveDetails'],
  ['control/common/mcp', 'common/mcp'],
  ['control/common/mcpConformance', 'common/mcp-conformance'],
  ['control/common/providerAccess', 'common/providerAccess'],
  ['control/common/requests', 'common/control-requests'],
  ['control/common/results', 'common/run-results'],
  ['control/common/triggerCatalog', 'common/trigger-catalog'],
  ['decision/common/decision', 'common/decision'],
  ['event-source/common/definition', 'common/event-source-definition'],
  ['event-source/common/index', 'common/event-source'],
  ['event-source/common/view', 'common/event-source-view'],
  ['execution/common/checkpoint', 'common/scheduler-checkpoint'],
  ['execution/common/dependencies', 'common/scheduler-dependencies'],
  ['runtime/common/engineContract', 'common/engine-contract'],
  ['execution/common/events', 'common/run-events'],
  ['execution/common/node-execution', 'common/scheduler-node-execution'],
  ['execution/common/runLifecycle', 'common/run-lifecycle'],
  ['runtime/common/runtime', 'common/runtime-contract'],
  ['runtime/common/nodejsCompat', 'common/runtime-nodejs-compat'],
  ['execution/common/scheduler', 'common/scheduler'],
  ['flow/common/agent', 'common/flow-agent'],
  ['flow/common/authoring', 'common/flow-authoring'],
  ['flow/common/change', 'common/flow-change'],
  ['flow/common/changeSchema', 'common/flow-change-schema'],
  ['flow/common/connectionUsage', 'common/flow-connectionUsage'],
  ['flow/common/edgeChanges', 'common/flow-authoring-edge'],
  ['flow/common/encoding', 'common/flow-encoding'],
  ['flow/common/errorHandling', 'common/flow-errorHandling'],
  ['flow/common/graph', 'common/flow-graph'],
  ['flow/common/inputValue', 'common/flow-input-value'],
  ['flow/common/json', 'common/flow-json'],
  ['flow/common/moduleChanges', 'common/flow-authoring-module'],
  ['flow/common/model', 'common/flow-model'],
  ['flow/common/modules', 'common/flow-modules'],
  ['flow/common/nodeChanges', 'common/flow-authoring-node'],
  ['flow/common/promptTemplate', 'common/flow-promptTemplate'],
  ['flow/common/retry', 'common/flow-retry'],
  ['flow/common/schema', 'common/flow-schema'],
  ['flow/common/schemaKeywords', 'common/flow-schemaKeywords'],
  ['flow/common/semantics', 'common/flow-semantics'],
  ['flow/common/webhookMethod', 'common/webhook-method'],
  ['flow/common/webhookResponse', 'common/webhook-response'],
  ['flow/common/workflowFile', 'common/flow-workflowFile'],
  ['flow/common/workflowReferences', 'common/flow-workflowReferences'],
  ['http/common/hosts', 'common/http-hosts'],
  ['state/common/conformance', 'common/state-conformance'],
  ['state/common/state', 'common/flow-state'],
  ['http/common/httpRequest', 'common/http-request'],
  ['localization/common/languages', 'common/localization'],
  ['openapi/common/openapi', 'common/openapi'],
  ['trigger/common/config', 'common/trigger-config'],
  ['trigger/common/configOptions', 'common/trigger-config-options'],
  ['trigger/common/contract', 'common/trigger-contract'],
  ['trigger/common/cron', 'common/cron-trigger'],
  ['trigger/common/integration', 'common/integration-trigger'],
  ['trigger/common/model', 'common/trigger-model'],
  ['trigger/common/poll', 'common/poll-trigger'],
  ['trigger/common/webhook', 'common/webhook-trigger'],
  ['trigger/providers/definitions', 'common/provider-triggers'],
  ['trigger/providers/localization', 'common/trigger-localization'],
  ['ui/browser/public', 'browser/ui'],
  ...['input', 'label', 'logo', 'textarea', 'hostTooltip', 'hostNavigationActions', 'idTooltip'].map(
    (name) => [`ui/browser/${name}`, `browser/ui-${name}`] as const,
  ),
  ['workbench/browser/runtime/contract', 'browser/workbench-contract'],
  ['workbench/browser/runtime/eventSources', 'browser/event-sources'],
  ['workbench/browser/runtime/hostConformance', 'browser/host-conformance'],
  ['workbench/browser/runtime/openFlowPreview', 'browser/preview'],
  ['workbench/browser/runtime/openFlowWorkbench', 'browser/workbench'],
  ['workflow/common/workflow', 'common/workflow'],
]
/** Declarations published by the npm package stage rather than this build. */
const externalDeclarations: readonly (readonly [source: string, output: string])[] = [['types/index', 'index']]

interface BuildBrowserPackageOptions {
  readonly packageRoot: string
  readonly quiet: boolean
  readonly sourceRoot: string
}

export async function buildBrowserPackage(options: BuildBrowserPackageOptions): Promise<void> {
  const browserOutputPath = path.join(options.packageRoot, 'dist/browser')
  const commonOutputPath = path.join(options.packageRoot, 'dist/common')
  await buildRuntime(options, commonOutputPath, connectorProxyEntryPath, 'connector-proxy', true)
  await buildRuntime(options, commonOutputPath, 'src/decision/common/decision.ts', 'decision', false)
  await buildRuntime(options, commonOutputPath, 'src/state/common/state.ts', 'flow-state', false)
  await buildRuntime(options, commonOutputPath, 'src/http/common/httpRequest.ts', 'http-request', false)
  await buildRuntime(options, commonOutputPath, 'src/openapi/common/openapi.ts', 'openapi', false)
  await buildRuntime(options, commonOutputPath, 'src/workflow/common/workflow.ts', 'workflow', false)
  await buildRuntime(options, commonOutputPath, connectorActionEntryPath, 'connector-action', false)
  await buildRuntime(options, commonOutputPath, controlRequestsEntryPath, 'control-requests', false)
  await buildRuntime(options, commonOutputPath, mcpEntryPath, 'mcp', false)
  await buildRuntime(options, commonOutputPath, controlApiEntryPath, 'control-api', false)
  await buildRuntime(options, commonOutputPath, controlApiConformanceEntryPath, 'control-api-conformance', false)
  await buildRuntime(options, commonOutputPath, runLifecycleEntryPath, 'run-lifecycle', false)
  await buildRuntime(options, commonOutputPath, runEventsEntryPath, 'run-events', false)
  await buildRuntime(options, commonOutputPath, runtimeContractEntryPath, 'runtime-contract', false)
  await buildRuntime(options, commonOutputPath, runtimeNodejsCompatEntryPath, 'runtime-nodejs-compat', false)
  await buildRuntime(options, commonOutputPath, flowEncodingEntryPath, 'flow-encoding', false)
  await buildRuntime(options, commonOutputPath, flowSemanticsEntryPath, 'flow-semantics', false)
  await buildRuntime(options, commonOutputPath, schedulerEntryPath, 'scheduler', false)
  await buildRuntime(options, commonOutputPath, cronTriggerEntryPath, 'cron-trigger', false)
  await buildRuntime(options, commonOutputPath, eventSourceEntryPath, 'event-source', false)
  await buildRuntime(options, commonOutputPath, integrationTriggerEntryPath, 'integration-trigger', false)
  await buildRuntime(options, commonOutputPath, pollTriggerEntryPath, 'poll-trigger', false)
  await buildRuntime(options, commonOutputPath, providerTriggersEntryPath, 'provider-triggers', false)
  await buildRuntime(options, commonOutputPath, webhookTriggerEntryPath, 'webhook-trigger', false)
  await buildRuntime(options, commonOutputPath, localizationEntryPath, 'localization', false)
  await buildRuntime(options, commonOutputPath, flowChangeEntryPath, 'flow-change', false)
  await buildRuntime(options, commonOutputPath, flowAuthoringEntryPath, 'flow-authoring', false)
  await buildRuntime(options, browserOutputPath, hostConformanceEntryPath, 'host-conformance', true)
  await buildRuntime(options, browserOutputPath, uiEntryPath, 'ui', false)
  await buildRuntime(options, browserOutputPath, previewEntryPath, 'preview', false)
  await buildRuntime(options, browserOutputPath, workbenchEntryPath, 'workbench', false)
  await copyFile(path.join(options.sourceRoot, 'src/ui/browser/theme.css'), path.join(browserOutputPath, 'theme.css'))
  await writeDeclarations(options)
}

async function buildRuntime(
  options: BuildBrowserPackageOptions,
  outputPath: string,
  entryPath: string,
  outputName: string,
  emptyOutDir: boolean,
): Promise<void> {
  const sharedTriggerPaths = new Map([
    [path.join(options.sourceRoot, integrationTriggerEntryPath), './integration-trigger.js'],
    [path.join(options.sourceRoot, pollTriggerEntryPath), './poll-trigger.js'],
  ])
  await build({
    build: {
      emptyOutDir,
      lib: {
        cssFileName: outputName,
        entry: path.join(options.sourceRoot, entryPath),
        fileName: outputName,
        formats: ['es'],
      },
      license: { fileName: 'licenses.md' },
      // Let consumers minify: pre-minified loop declarations can break Rollup when shared chunks are re-bundled.
      minify: false,
      outDir: outputPath,
      rolldownOptions: {
        external: entryPath == providerTriggersEntryPath || entryPath == eventSourceEntryPath ? [...sharedTriggerPaths.keys()] : undefined,
        output: {
          assetFileNames: '[name][extname]',
          entryFileNames: `${outputName}.js`,
          paths: entryPath == providerTriggersEntryPath || entryPath == eventSourceEntryPath ? Object.fromEntries(sharedTriggerPaths) : undefined,
        },
      },
    },
    configFile: false,
    css: { modules: { generateScopedName } },
    define: { 'process.env': '{}' },
    logLevel: options.quiet ? 'silent' : 'info',
    plugins: [
      esmExternalRequirePlugin({ external: [/^effect(?:\/.*)?$/, /^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/] }),
      providerIconsPlugin(),
      twemojiCollectionPlugin(),
      tailwindcss(),
      UnoCSS(designerUnoConfig),
    ],
    root: options.sourceRoot,
  })
  if (entryPath == workbenchEntryPath || entryPath == previewEntryPath) await extractFonts(path.join(outputPath, `${outputName}.css`), outputPath)
}

async function extractFonts(cssPath: string, outputPath: string): Promise<void> {
  const fonts = new Map<string, Buffer>()
  const css = (await readFile(cssPath, 'utf8')).replaceAll(
    /data:font\/(woff2|woff|ttf);base64,([A-Za-z\d+/=]+)/g,
    (_match: string, format: string, encoded: string) => {
      const bytes = Buffer.from(encoded, 'base64')
      const file = `font-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${format}`
      fonts.set(file, bytes)
      return `./assets/${file}`
    },
  )
  if (fonts.size == 0) return
  const assetsPath = path.join(outputPath, 'assets')
  await mkdir(assetsPath, { recursive: true })
  await Promise.all([...fonts].map(([file, bytes]) => writeFile(path.join(assetsPath, file), bytes)))
  await writeFile(cssPath, css)
}

async function writeDeclarations(options: BuildBrowserPackageOptions): Promise<void> {
  const declarationRoot = path.join(options.packageRoot, '.browser-declarations')
  const compiler = path.join(path.dirname(packageRequire.resolve('typescript/package.json')), 'bin/tsc')
  try {
    await execFileAsync(
      process.execPath,
      [
        compiler,
        '--ignoreConfig',
        '--declaration',
        '--emitDeclarationOnly',
        '--outDir',
        declarationRoot,
        '--rootDir',
        path.join(options.sourceRoot, 'src'),
        '--module',
        'preserve',
        '--moduleResolution',
        'bundler',
        '--target',
        'esnext',
        '--jsx',
        'react-jsx',
        '--skipLibCheck',
        'true',
        '--allowImportingTsExtensions',
        'true',
        '--esModuleInterop',
        'true',
        '--experimentalDecorators',
        'true',
        '--types',
        'node,vite/client',
        path.join(options.sourceRoot, 'src/browser-assets.d.ts'),
        path.join(options.sourceRoot, connectorActionEntryPath),
        path.join(options.sourceRoot, connectorProxyEntryPath),
        path.join(options.sourceRoot, controlRequestsEntryPath),
        path.join(options.sourceRoot, mcpEntryPath),
        path.join(options.sourceRoot, controlApiEntryPath),
        path.join(options.sourceRoot, controlApiConformanceEntryPath),
        path.join(options.sourceRoot, controlApiErrorsEntryPath),
        path.join(options.sourceRoot, flowNotificationsEntryPath),
        path.join(options.sourceRoot, flowEncodingEntryPath),
        path.join(options.sourceRoot, flowSemanticsEntryPath),
        path.join(options.sourceRoot, runEventsEntryPath),
        path.join(options.sourceRoot, runLifecycleEntryPath),
        path.join(options.sourceRoot, runtimeContractEntryPath),
        path.join(options.sourceRoot, runtimeNodejsCompatEntryPath),
        path.join(options.sourceRoot, schedulerEntryPath),
        path.join(options.sourceRoot, cronTriggerEntryPath),
        path.join(options.sourceRoot, integrationTriggerEntryPath),
        path.join(options.sourceRoot, eventSourceEntryPath),
        path.join(options.sourceRoot, pollTriggerEntryPath),
        path.join(options.sourceRoot, providerTriggersEntryPath),
        path.join(options.sourceRoot, webhookTriggerEntryPath),
        path.join(options.sourceRoot, localizationEntryPath),
        path.join(options.sourceRoot, flowAuthoringEntryPath),
        path.join(options.sourceRoot, flowChangeEntryPath),
        path.join(options.sourceRoot, hostConformanceEntryPath),
        path.join(options.sourceRoot, workbenchDeclarationEntryPath),
        path.join(options.sourceRoot, previewDeclarationEntryPath),
        path.join(options.sourceRoot, uiDeclarationEntryPath),
      ],
      { cwd: options.sourceRoot },
    )
    const outputsBySource = new Map<string, string[]>()
    for (const [source, output] of [...declarationOutputs, ...externalDeclarations])
      outputsBySource.set(source, [...(outputsBySource.get(source) ?? []), output])
    const distPath = path.join(options.packageRoot, 'dist')
    await Promise.all([
      ...declarationOutputs.map(async ([source, output]) => {
        const declaration = await readFile(path.join(declarationRoot, `${source}.d.ts`), 'utf8')
        await writeFile(path.join(distPath, `${output}.d.ts`), rewriteDeclarationImports(declaration, source, output, outputsBySource))
      }),
      ...['browser/ui.css', 'browser/preview.css', 'browser/workbench.css', 'browser/theme.css'].map((output) =>
        writeFile(path.join(distPath, `${output}.d.ts`), 'export {}\n'),
      ),
    ])
  } finally {
    await rm(declarationRoot, { force: true, recursive: true })
  }
}

/** Rewrites each relative source import to the published declaration of the same source. */
function rewriteDeclarationImports(declaration: string, source: string, output: string, outputsBySource: ReadonlyMap<string, readonly string[]>): string {
  const outputDirectory = path.posix.dirname(output)
  return declaration.replaceAll(
    /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"']+)\2/g,
    (_match: string, prefix: string, quote: string, specifier: string) => {
      const target = path.posix.join(path.posix.dirname(source), specifier).replace(/\.(?:tsx?|js)$/, '')
      const outputs = outputsBySource.get(target)
      if (outputs == null) throw new Error(`Declaration ${source} imports ${target}, which has no published declaration.`)
      const published = outputs.find((candidate) => path.posix.dirname(candidate) == outputDirectory) ?? outputs[0]!
      const relative = path.posix.relative(outputDirectory, published)
      return `${prefix}${quote}${relative.startsWith('.') ? relative : `./${relative}`}.js${quote}`
    },
  )
}
