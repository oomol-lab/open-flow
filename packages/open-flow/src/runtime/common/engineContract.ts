/**
 * Content-enabled Flow features whose execution needs Engine support, with the contract revision that first executes
 * each. Names are permanent once published; Flow detection lives in the Flow feature registry.
 */
export const engineCapabilityRevisions = {
  'webhook-response': 7,
  'wait-auto-continue': 7,
  'workflow-tools': 8,
  'http-request': 8,
  'code-http': 9,
  'skip-duplicates': 10,
  'connector-proxy': 11,
  'delay': 12,
} as const

export type EngineCapability = keyof typeof engineCapabilityRevisions

function engineCapabilitiesThrough(revision: number): ReadonlySet<EngineCapability> {
  return new Set((Object.keys(engineCapabilityRevisions) as EngineCapability[]).filter((name) => engineCapabilityRevisions[name] <= revision))
}

/**
 * Execution semantics of one contract revision. Guest-visible interfaces are semantics: they are fixed by the contract
 * whether or not a Flow uses the matching nodes, so a deployment cannot withdraw them.
 */
export interface EngineContract {
  /** Content-enabled features this contract executes. Flows that use others are rejected before preparation. */
  readonly capabilities: ReadonlySet<EngineCapability>
  readonly builtinModules?: ReadonlySet<string>
  readonly platformExports: ReadonlySet<string>
  readonly platformModule: string
  readonly platformSource: string
  /** Code receives `context.workflows`. */
  readonly workflowTools?: boolean
  /** Code may call `context.fetch` for hosts declared by its `http` Capability, replacing `context.egress`. */
  readonly codeFetch?: boolean
  /** Code receives `context.state` and `context.dedupe`. */
  readonly flowState?: boolean
}

/**
 * The current execution semantics. Features that do not change guest interfaces or existing results join this
 * contract's capabilities instead of allocating a new revision.
 */
export const currentEngineContract = 'open-flow-engine/v12'
/** The published v8 Node compatibility contract, retained for existing Publications and Runs. */
export const nodejsEngineContract = 'open-flow-engine/v8/nodejs-compat-v1'

const platformSource = (contract: string) => `export const engineContract = ${JSON.stringify(contract)}
export function identity(value) { return value }
`

const v8Contract: EngineContract = {
  capabilities: engineCapabilitiesThrough(8),
  workflowTools: true,
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

const v9Contract: EngineContract = {
  ...nodejsContract,
  capabilities: engineCapabilitiesThrough(9),
  codeFetch: true,
  platformSource: platformSource('open-flow-engine/v9'),
}
const v10Contract: EngineContract = {
  ...v9Contract,
  capabilities: engineCapabilitiesThrough(10),
  flowState: true,
  platformSource: platformSource('open-flow-engine/v10'),
}
const v11Contract: EngineContract = { ...v10Contract, capabilities: engineCapabilitiesThrough(11), platformSource: platformSource('open-flow-engine/v11') }
const currentContract: EngineContract = { ...v11Contract, capabilities: engineCapabilitiesThrough(12), platformSource: platformSource(currentEngineContract) }

export function findEngineContract(contract: string): EngineContract | undefined {
  if (contract == currentEngineContract) return currentContract
  if (contract == 'open-flow-engine/v11') return v11Contract
  if (contract == 'open-flow-engine/v10') return v10Contract
  if (contract == 'open-flow-engine/v9') return v9Contract
  if (contract == 'open-flow-engine/v8') return v8Contract
  if (contract == nodejsEngineContract) return nodejsContract
  if (contract == 'open-flow-engine/v7' || contract == 'open-flow-engine/v7/nodejs-compat-v1')
    return {
      ...(contract.endsWith('/nodejs-compat-v1') ? nodejsContract : v8Contract),
      capabilities: engineCapabilitiesThrough(7),
      workflowTools: false,
      platformSource: platformSource(contract),
    }
  if (contract == 'open-flow-engine/v6' || contract == 'open-flow-engine/v6/nodejs-compat-v1')
    return {
      ...(contract == 'open-flow-engine/v6' ? v8Contract : nodejsContract),
      capabilities: engineCapabilitiesThrough(6),
      workflowTools: false,
      platformSource: platformSource(contract),
    }
  return undefined
}
