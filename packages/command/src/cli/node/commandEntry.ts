#!/usr/bin/env bun

import type { OpenFlowCommandHost } from './runtime.ts'

import { runCommand } from './runtime.ts'
export { commandArtifactVersion } from '../../distribution/common/commandProtocol.ts'

declare const openFlowVersionBuildConstant: string

export async function runOpenFlowCommand(args: readonly string[], host: OpenFlowCommandHost = {}): Promise<number> {
  return await runCommand(args, host, { version: openFlowVersionBuildConstant })
}

if (import.meta.main) process.exitCode = await runOpenFlowCommand(process.argv.slice(2))
