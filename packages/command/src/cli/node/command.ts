import { version } from '../../../package.json'
import { runCommand } from './runtime.ts'

export interface OpenFlowCommandHost {
  readonly cloudRequest?: (path: string, init?: RequestInit) => Promise<Response>
  getWorkbenchUrl?(flowId?: string): Promise<string>
  readonly language?: string
}

export async function runOpenFlowCommand(args: readonly string[], host: OpenFlowCommandHost = {}): Promise<number> {
  return await runCommand(args, host, { version })
}
