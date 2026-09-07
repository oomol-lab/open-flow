export interface EngineContract {
  readonly platformExports: ReadonlySet<string>
  readonly platformModule: string
  readonly platformSource: string
}

export const currentEngineContract = 'open-flow-engine/v2'

const currentContract: EngineContract = {
  platformExports: new Set(['engineContract', 'identity']),
  platformModule: 'open-flow:platform',
  platformSource: `export const engineContract = ${JSON.stringify(currentEngineContract)}
export function identity(value) { return value }
`,
}

export function findEngineContract(contract: string): EngineContract | undefined {
  return contract == currentEngineContract ? currentContract : undefined
}
