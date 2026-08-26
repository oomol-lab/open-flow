import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface StageNpmPackageOptions {
  readonly packageRoot: string
  readonly sourceRoot: string
  readonly version: string
}

export async function stageNpmPackage(options: StageNpmPackageOptions): Promise<void> {
  const { packageRoot, sourceRoot, version } = options
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
  await Promise.all([
    copyFile(path.join(sourceRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE')),
    copyFile(path.join(sourceRoot, 'NOTICE'), path.join(packageRoot, 'NOTICE')),
    writeFile(path.join(packageRoot, 'README.md'), renderReadme()),
    writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(createManifest(version), undefined, 2)}\n`),
  ])
}

function createManifest(version: string): object {
  return {
    name: '@oomol-lab/open-flow',
    version,
    description: 'TypeScript contracts and Browser runtime for Open Flow.',
    license: 'Apache-2.0',
    repository: {
      type: 'git',
      url: 'git+https://github.com/oomol-lab/open-flow.git',
      directory: 'packages/open-flow',
    },
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
      },
      './connector-action': {
        types: './dist/common/connector-action.d.ts',
        import: './dist/common/connector-action.js',
      },
      './connector-proxy': {
        types: './dist/common/connector-proxy.d.ts',
        import: './dist/common/connector-proxy.js',
      },
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
      './integration-trigger': {
        types: './dist/common/integration-trigger.d.ts',
        import: './dist/common/integration-trigger.js',
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
        types: './dist/browser/flow-authoring.d.ts',
        import: './dist/browser/flow-authoring.js',
      },
      './flow-change': {
        types: './dist/browser/flow-change.d.ts',
        import: './dist/browser/flow-change.js',
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
      './scheduler': {
        types: './dist/common/scheduler.d.ts',
        import: './dist/common/scheduler.js',
      },
      './webhook-trigger': {
        types: './dist/common/webhook-trigger.d.ts',
        import: './dist/common/webhook-trigger.js',
      },
      './workbench': {
        types: './dist/browser/workbench.d.ts',
        import: './dist/browser/workbench.js',
      },
      './workbench.css': {
        types: './dist/browser/workbench.css.d.ts',
        default: './dist/browser/workbench.css',
      },
      './theme.css': {
        types: './dist/browser/theme.css.d.ts',
        default: './dist/browser/theme.css',
      },
    },
    files: ['dist', 'README.md', 'NOTICE', 'LICENSE'],
    peerDependencies: {
      'effect': '4.0.0-rc.112',
      'react': '^18.3.1 || ^19.0.0',
      'react-dom': '^18.3.1 || ^19.0.0',
    },
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

Install the Task contracts as a development dependency:

\`\`\`bash
bun add --dev @oomol-lab/open-flow
\`\`\`

Hosted products can use the controlled Workbench runtime:

\`\`\`ts
import { OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import '@oomol-lab/open-flow/workbench.css'
\`\`\`

Deployment chrome can import \`@oomol-lab/open-flow/theme.css\` and apply \`open-flow-theme\` plus \`data-theme\` to its root.

The Open Flow command and hosted Workbench applications are distributed separately.
`
}
