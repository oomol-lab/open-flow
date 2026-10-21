export interface EngineContract {
  readonly builtinModules?: ReadonlySet<string>
  readonly platformExports: ReadonlySet<string>
  readonly platformModule: string
  readonly platformSource: string
  readonly webhookResponses?: boolean
}

export const currentEngineContract = 'open-flow-engine/v7'
export const nodejsEngineContract = 'open-flow-engine/v7/nodejs-compat-v1'

const currentContract: EngineContract = {
  webhookResponses: true,
  platformExports: new Set(['engineContract', 'identity']),
  platformModule: 'open-flow:platform',
  platformSource: `export const engineContract = ${JSON.stringify(currentEngineContract)}
export function identity(value) { return value }
`,
}

const nodejsContract: EngineContract = {
  ...currentContract,
  builtinModules: new Set(
    [
      'assert',
      'assert/strict',
      'buffer',
      'console',
      'constants',
      'crypto',
      'events',
      'fs',
      'fs/promises',
      'os',
      'path',
      'path/posix',
      'process',
      'punycode',
      'querystring',
      'stream',
      'stream/promises',
      'stream/web',
      'string_decoder',
      'timers',
      'timers/promises',
      'url',
      'util',
      'zlib',
    ].flatMap((name) => [name, `node:${name}`]),
  ),
  platformSource: `export const engineContract = ${JSON.stringify(nodejsEngineContract)}
export function identity(value) { return value }
`,
}

export function findEngineContract(contract: string): EngineContract | undefined {
  if (contract == currentEngineContract) return currentContract
  if (contract == nodejsEngineContract) return nodejsContract
  if (contract == 'open-flow-engine/v6' || contract == 'open-flow-engine/v6/nodejs-compat-v1')
    return {
      ...(contract == 'open-flow-engine/v6' ? currentContract : nodejsContract),
      webhookResponses: false,
      platformSource: `export const engineContract = ${JSON.stringify(contract)}
export function identity(value) { return value }
`,
    }
  return undefined
}
