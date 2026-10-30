export interface EngineContract {
  readonly builtinModules?: ReadonlySet<string>
  readonly platformExports: ReadonlySet<string>
  readonly platformModule: string
  readonly platformSource: string
  readonly waitAutoContinue?: boolean
  readonly webhookResponses?: boolean
  readonly workflowTools?: boolean
  readonly httpRequests?: boolean
  /** Code may call `context.fetch` for hosts declared by its `http` Capability. */
  readonly codeFetch?: boolean
}

/** v9 is a single contract: the Node compatibility builtins, `context.fetch`, and no `context.egress`. */
export const currentEngineContract = 'open-flow-engine/v9'
/** The published v8 Node compatibility contract, retained for existing Publications and Runs. */
export const nodejsEngineContract = 'open-flow-engine/v8/nodejs-compat-v1'

const platformSource = (contract: string) => `export const engineContract = ${JSON.stringify(contract)}
export function identity(value) { return value }
`

const v8Contract: EngineContract = {
  workflowTools: true,
  httpRequests: true,
  waitAutoContinue: true,
  webhookResponses: true,
  platformExports: new Set(['engineContract', 'identity']),
  platformModule: 'open-flow:platform',
  platformSource: platformSource('open-flow-engine/v8'),
}

const nodejsContract: EngineContract = {
  ...v8Contract,
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
  platformSource: platformSource(nodejsEngineContract),
}

const currentContract: EngineContract = { ...nodejsContract, codeFetch: true, platformSource: platformSource(currentEngineContract) }

export function findEngineContract(contract: string): EngineContract | undefined {
  if (contract == currentEngineContract) return currentContract
  if (contract == 'open-flow-engine/v8') return v8Contract
  if (contract == nodejsEngineContract) return nodejsContract
  if (contract == 'open-flow-engine/v7' || contract == 'open-flow-engine/v7/nodejs-compat-v1')
    return {
      ...(contract.endsWith('/nodejs-compat-v1') ? nodejsContract : v8Contract),
      workflowTools: false,
      httpRequests: false,
      platformSource: platformSource(contract),
    }
  if (contract == 'open-flow-engine/v6' || contract == 'open-flow-engine/v6/nodejs-compat-v1')
    return {
      ...(contract == 'open-flow-engine/v6' ? v8Contract : nodejsContract),
      workflowTools: false,
      httpRequests: false,
      waitAutoContinue: false,
      webhookResponses: false,
      platformSource: platformSource(contract),
    }
  return undefined
}
