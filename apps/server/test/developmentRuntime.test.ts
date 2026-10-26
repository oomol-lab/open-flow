import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { it } from 'vitest'

const execute = promisify(execFile)

it('loads the Server application with native Node TypeScript support', async () => {
  const application = new URL('../node/application/service.ts', import.meta.url)
  await execute(process.execPath, ['--no-node-snapshot', '--input-type=module', '--eval', `await import(${JSON.stringify(application.href)})`])
})
