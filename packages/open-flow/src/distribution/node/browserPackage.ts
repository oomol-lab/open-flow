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
import { twemojiCollectionPlugin } from '../../build/node/twemojiCollection.ts'

const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const connectorActionEntryPath = 'src/connector/common/actionSchema.ts'
const connectorProxyEntryPath = 'src/connector/common/proxy.ts'
const controlApiEntryPath = 'src/control/common/api.ts'
const controlApiConformanceEntryPath = 'src/control/common/conformance.ts'
const controlApiErrorsEntryPath = 'src/control/common/errors.ts'
const flowNotificationsEntryPath = 'src/control/common/flowNotifications.ts'
const cronTriggerEntryPath = 'src/trigger/common/cron.ts'
const integrationTriggerEntryPath = 'src/trigger/common/integration.ts'
const pollTriggerEntryPath = 'src/trigger/common/poll.ts'
const providerTriggersEntryPath = 'src/trigger/providers/definitions.ts'
const flowAuthoringEntryPath = 'src/flow/common/authoring.ts'
const flowChangeEntryPath = 'src/flow/common/change.ts'
const flowEncodingEntryPath = 'src/flow/common/encoding.ts'
const flowSemanticsEntryPath = 'src/flow/common/semantics.ts'
const runLifecycleEntryPath = 'src/execution/common/runLifecycle.ts'
const runEventsEntryPath = 'src/execution/common/events.ts'
const runtimeContractEntryPath = 'src/execution/common/runtime.ts'
const schedulerEntryPath = 'src/execution/common/scheduler.ts'
const webhookTriggerEntryPath = 'src/trigger/common/webhook.ts'
const workbenchEntryPath = 'src/workbench/browser/runtime/openFlowWorkbench.tsx'

interface BuildBrowserPackageOptions {
  readonly packageRoot: string
  readonly quiet: boolean
  readonly sourceRoot: string
}

export async function buildBrowserPackage(options: BuildBrowserPackageOptions): Promise<void> {
  const browserOutputPath = path.join(options.packageRoot, 'dist/browser')
  const commonOutputPath = path.join(options.packageRoot, 'dist/common')
  await buildRuntime(options, commonOutputPath, connectorProxyEntryPath, 'connector-proxy', true)
  await buildRuntime(options, commonOutputPath, connectorActionEntryPath, 'connector-action', false)
  await buildRuntime(options, commonOutputPath, controlApiEntryPath, 'control-api', false)
  await buildRuntime(options, commonOutputPath, controlApiConformanceEntryPath, 'control-api-conformance', false)
  await buildRuntime(options, commonOutputPath, runLifecycleEntryPath, 'run-lifecycle', false)
  await buildRuntime(options, commonOutputPath, runEventsEntryPath, 'run-events', false)
  await buildRuntime(options, commonOutputPath, runtimeContractEntryPath, 'runtime-contract', false)
  await buildRuntime(options, commonOutputPath, flowEncodingEntryPath, 'flow-encoding', false)
  await buildRuntime(options, commonOutputPath, flowSemanticsEntryPath, 'flow-semantics', false)
  await buildRuntime(options, commonOutputPath, schedulerEntryPath, 'scheduler', false)
  await buildRuntime(options, commonOutputPath, cronTriggerEntryPath, 'cron-trigger', false)
  await buildRuntime(options, commonOutputPath, integrationTriggerEntryPath, 'integration-trigger', false)
  await buildRuntime(options, commonOutputPath, pollTriggerEntryPath, 'poll-trigger', false)
  await buildRuntime(options, commonOutputPath, providerTriggersEntryPath, 'provider-triggers', false)
  await buildRuntime(options, commonOutputPath, webhookTriggerEntryPath, 'webhook-trigger', false)
  await buildRuntime(options, browserOutputPath, flowChangeEntryPath, 'flow-change', true)
  await buildRuntime(options, browserOutputPath, flowAuthoringEntryPath, 'flow-authoring', false)
  await buildRuntime(options, browserOutputPath, workbenchEntryPath, 'workbench', false)
  await copyFile(path.join(options.sourceRoot, 'src/ui/browser/theme.css'), path.join(browserOutputPath, 'theme.css'))
  await writeDeclarations(options, browserOutputPath, commonOutputPath)
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
      outDir: outputPath,
      rolldownOptions: {
        external: entryPath == providerTriggersEntryPath ? [...sharedTriggerPaths.keys()] : undefined,
        output: {
          assetFileNames: '[name][extname]',
          entryFileNames: `${outputName}.js`,
          paths: entryPath == providerTriggersEntryPath ? Object.fromEntries(sharedTriggerPaths) : undefined,
        },
      },
    },
    configFile: false,
    css: { modules: { generateScopedName } },
    define: { 'process.env': '{}' },
    logLevel: options.quiet ? 'silent' : 'info',
    plugins: [
      esmExternalRequirePlugin({ external: [/^effect(?:\/.*)?$/, /^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/] }),
      twemojiCollectionPlugin(),
      tailwindcss(),
      UnoCSS(designerUnoConfig),
    ],
    root: options.sourceRoot,
  })
  if (entryPath == workbenchEntryPath) await extractFonts(path.join(outputPath, `${outputName}.css`), outputPath)
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

async function writeDeclarations(options: BuildBrowserPackageOptions, browserOutputPath: string, commonOutputPath: string): Promise<void> {
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
        path.join(options.sourceRoot, controlApiEntryPath),
        path.join(options.sourceRoot, controlApiConformanceEntryPath),
        path.join(options.sourceRoot, controlApiErrorsEntryPath),
        path.join(options.sourceRoot, flowNotificationsEntryPath),
        path.join(options.sourceRoot, flowEncodingEntryPath),
        path.join(options.sourceRoot, flowSemanticsEntryPath),
        path.join(options.sourceRoot, runEventsEntryPath),
        path.join(options.sourceRoot, runLifecycleEntryPath),
        path.join(options.sourceRoot, runtimeContractEntryPath),
        path.join(options.sourceRoot, schedulerEntryPath),
        path.join(options.sourceRoot, cronTriggerEntryPath),
        path.join(options.sourceRoot, integrationTriggerEntryPath),
        path.join(options.sourceRoot, pollTriggerEntryPath),
        path.join(options.sourceRoot, providerTriggersEntryPath),
        path.join(options.sourceRoot, webhookTriggerEntryPath),
        path.join(options.sourceRoot, flowAuthoringEntryPath),
        path.join(options.sourceRoot, flowChangeEntryPath),
        path.join(options.sourceRoot, workbenchEntryPath),
      ],
      { cwd: options.sourceRoot },
    )
    const workbenchDeclaration = await readFile(path.join(declarationRoot, 'workbench/browser/runtime/openFlowWorkbench.d.ts'), 'utf8')
    const workbenchStyleImport = "import './styles.css';\n"
    if (!workbenchDeclaration.startsWith(workbenchStyleImport)) throw new Error('Workbench declaration did not contain the expected style import.')
    const workbenchContract = (await readFile(path.join(declarationRoot, 'workbench/browser/runtime/contract.d.ts'), 'utf8')).replaceAll(
      "'../../../control/common/flowNotifications.ts'",
      "'./flow-notifications.js'",
    )
    const flowNotificationsDeclaration = await readFile(path.join(declarationRoot, 'control/common/flowNotifications.d.ts'), 'utf8')
    const flowAuthoringDeclaration = (await readFile(path.join(declarationRoot, 'flow/common/authoring.d.ts'), 'utf8'))
      .replaceAll("'./edgeChanges.ts'", "'./flow-authoring-edge.js'")
      .replaceAll("'./moduleChanges.ts'", "'./flow-authoring-module.js'")
      .replaceAll("'./nodeChanges.ts'", "'./flow-authoring-node.js'")
    const flowAuthoringEdgeDeclaration = (await readFile(path.join(declarationRoot, 'flow/common/edgeChanges.d.ts'), 'utf8')).replaceAll(
      "'./change.ts'",
      "'./flow-change.js'",
    )
    const flowAuthoringModuleDeclaration = (await readFile(path.join(declarationRoot, 'flow/common/moduleChanges.d.ts'), 'utf8')).replaceAll(
      "'./change.ts'",
      "'./flow-change.js'",
    )
    const flowAuthoringNodeDeclaration = (await readFile(path.join(declarationRoot, 'flow/common/nodeChanges.d.ts'), 'utf8')).replaceAll(
      "'./change.ts'",
      "'./flow-change.js'",
    )
    const flowChangeDeclaration = await readFile(path.join(declarationRoot, 'flow/common/change.d.ts'), 'utf8')
    const connectorActionDeclaration = await readFile(path.join(declarationRoot, 'connector/common/actionSchema.d.ts'), 'utf8')
    const connectorProxyDeclaration = await readFile(path.join(declarationRoot, 'connector/common/proxy.d.ts'), 'utf8')
    const controlApiDeclaration = (await readFile(path.join(declarationRoot, 'control/common/api.d.ts'), 'utf8'))
      .replaceAll("'../../execution/common/runLifecycle.ts'", "'./run-lifecycle.js'")
      .replaceAll("'../../flow/common/change.ts'", "'../browser/flow-change.js'")
      .replaceAll("'./errors.ts'", "'./control-api-errors.js'")
      .replaceAll("'./flowNotifications.ts'", "'./flow-notifications.js'")
    const controlApiConformanceDeclaration = await readFile(path.join(declarationRoot, 'control/common/conformance.d.ts'), 'utf8')
    const controlApiErrorsDeclaration = await readFile(path.join(declarationRoot, 'control/common/errors.d.ts'), 'utf8')
    const flowEncodingDeclaration = await readFile(path.join(declarationRoot, 'flow/common/encoding.d.ts'), 'utf8')
    const flowSemanticsDeclaration = (await readFile(path.join(declarationRoot, 'flow/common/semantics.d.ts'), 'utf8'))
      .replaceAll("'../../execution/common/engineContract.ts'", "'./engine-contract.js'")
      .replaceAll("'../../execution/common/runtime.ts'", "'./runtime-contract.js'")
    const runLifecycleDeclaration = await readFile(path.join(declarationRoot, 'execution/common/runLifecycle.d.ts'), 'utf8')
    const runEventsDeclaration = await readFile(path.join(declarationRoot, 'execution/common/events.d.ts'), 'utf8')
    const engineContractDeclaration = await readFile(path.join(declarationRoot, 'execution/common/engineContract.d.ts'), 'utf8')
    const runtimeContractDeclaration = (await readFile(path.join(declarationRoot, 'execution/common/runtime.d.ts'), 'utf8'))
      .replaceAll("'../../flow/common/change.ts'", "'../browser/flow-change.js'")
      .replaceAll("'./engineContract.ts'", "'./engine-contract.js'")
    const schedulerDeclaration = (await readFile(path.join(declarationRoot, 'execution/common/scheduler.d.ts'), 'utf8'))
      .replaceAll("'../../flow/common/change.ts'", "'../browser/flow-change.js'")
      .replaceAll("'../../flow/common/semantics.ts'", "'./flow-semantics.js'")
    const cronTriggerDeclaration = (await readFile(path.join(declarationRoot, 'trigger/common/cron.d.ts'), 'utf8')).replaceAll(
      "'../../flow/common/change.ts'",
      "'../browser/flow-change.js'",
    )
    const integrationTriggerDeclaration = (await readFile(path.join(declarationRoot, 'trigger/common/integration.d.ts'), 'utf8'))
      .replaceAll("'../../connector/common/proxy.ts'", "'./connector-proxy.js'")
      .replaceAll("'../../flow/common/change.ts'", "'../browser/flow-change.js'")
    const pollTriggerDeclaration = (await readFile(path.join(declarationRoot, 'trigger/common/poll.d.ts'), 'utf8'))
      .replaceAll("'../../connector/common/proxy.ts'", "'./connector-proxy.js'")
      .replaceAll("'../../flow/common/change.ts'", "'../browser/flow-change.js'")
    const providerTriggersDeclaration = (await readFile(path.join(declarationRoot, 'trigger/providers/definitions.d.ts'), 'utf8'))
      .replaceAll("'../common/integration.ts'", "'./integration-trigger.js'")
      .replaceAll("'../common/poll.ts'", "'./poll-trigger.js'")
    const webhookTriggerDeclaration = (await readFile(path.join(declarationRoot, 'trigger/common/webhook.d.ts'), 'utf8')).replaceAll(
      "'../../flow/common/change.ts'",
      "'../browser/flow-change.js'",
    )
    await Promise.all([
      writeFile(path.join(browserOutputPath, 'flow-authoring.d.ts'), flowAuthoringDeclaration),
      writeFile(path.join(browserOutputPath, 'flow-authoring-edge.d.ts'), flowAuthoringEdgeDeclaration),
      writeFile(path.join(browserOutputPath, 'flow-authoring-module.d.ts'), flowAuthoringModuleDeclaration),
      writeFile(path.join(browserOutputPath, 'flow-authoring-node.d.ts'), flowAuthoringNodeDeclaration),
      writeFile(path.join(browserOutputPath, 'flow-change.d.ts'), flowChangeDeclaration),
      writeFile(path.join(commonOutputPath, 'flow-encoding.d.ts'), flowEncodingDeclaration),
      writeFile(path.join(commonOutputPath, 'flow-semantics.d.ts'), flowSemanticsDeclaration),
      writeFile(
        path.join(browserOutputPath, 'workbench.d.ts'),
        workbenchDeclaration.slice(workbenchStyleImport.length).replaceAll("'./contract.ts'", "'./workbench-contract.js'"),
      ),
      writeFile(path.join(browserOutputPath, 'workbench-contract.d.ts'), workbenchContract),
      writeFile(path.join(browserOutputPath, 'flow-notifications.d.ts'), flowNotificationsDeclaration),
      writeFile(path.join(browserOutputPath, 'workbench.css.d.ts'), 'export {}\n'),
      writeFile(path.join(browserOutputPath, 'theme.css.d.ts'), 'export {}\n'),
      writeFile(path.join(commonOutputPath, 'run-lifecycle.d.ts'), runLifecycleDeclaration),
      writeFile(path.join(commonOutputPath, 'run-events.d.ts'), runEventsDeclaration),
      writeFile(path.join(commonOutputPath, 'engine-contract.d.ts'), engineContractDeclaration),
      writeFile(path.join(commonOutputPath, 'runtime-contract.d.ts'), runtimeContractDeclaration),
      writeFile(path.join(commonOutputPath, 'scheduler.d.ts'), schedulerDeclaration),
      writeFile(path.join(commonOutputPath, 'connector-action.d.ts'), connectorActionDeclaration),
      writeFile(path.join(commonOutputPath, 'connector-proxy.d.ts'), connectorProxyDeclaration),
      writeFile(path.join(commonOutputPath, 'control-api.d.ts'), controlApiDeclaration),
      writeFile(path.join(commonOutputPath, 'control-api-errors.d.ts'), controlApiErrorsDeclaration),
      writeFile(path.join(commonOutputPath, 'flow-notifications.d.ts'), flowNotificationsDeclaration),
      writeFile(path.join(commonOutputPath, 'control-api-conformance.d.ts'), controlApiConformanceDeclaration),
      writeFile(path.join(commonOutputPath, 'cron-trigger.d.ts'), cronTriggerDeclaration),
      writeFile(path.join(commonOutputPath, 'integration-trigger.d.ts'), integrationTriggerDeclaration),
      writeFile(path.join(commonOutputPath, 'poll-trigger.d.ts'), pollTriggerDeclaration),
      writeFile(path.join(commonOutputPath, 'provider-triggers.d.ts'), providerTriggersDeclaration),
      writeFile(path.join(commonOutputPath, 'webhook-trigger.d.ts'), webhookTriggerDeclaration),
    ])
  } finally {
    await rm(declarationRoot, { force: true, recursive: true })
  }
}
