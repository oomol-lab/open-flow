import { runCommand } from '@oomol-lab/open-flow-command/development'
import commandManifest from '@oomol-lab/open-flow-command/package.json' with { type: 'json' }
import { loadDevelopmentEnvironment } from './development-config.ts'
import { createDevelopmentCommandHost } from './flow-host.ts'

loadDevelopmentEnvironment()
const args = process.argv.slice(2)
if (args[0] == '--') args.shift()
process.exitCode = await runCommand(args, createDevelopmentCommandHost(process.env), {
  version: commandManifest.version,
  commandPrefix: 'bun run flow --',
  scopeGuidance: [
    'Connects to the local development Server by default; start it separately with bun run dev.',
    'Use OPEN_FLOW_URL with OPEN_FLOW_TOKEN to select another Server. Credentials and service configuration belong to that deployment.',
  ],
})
