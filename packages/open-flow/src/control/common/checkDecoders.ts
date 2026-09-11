import type { Diagnostic, FlowCheck } from './api.ts'

import { integer, invalidResponse, record, string } from './decoding.ts'

function diagnostic(value: unknown): Diagnostic {
  const source = record(value)
  const values = source.values == null ? undefined : record(source.values)
  return {
    code: string(source.code),
    column: integer(source.column),
    line: integer(source.line),
    message: string(source.message),
    path: typeof source.path == 'string' ? source.path : invalidResponse(),
    ...(values == null
      ? {}
      : {
          values: Object.fromEntries(
            Object.entries(values).map(([key, candidate]) => [
              key,
              typeof candidate == 'string' || typeof candidate == 'number' ? candidate : invalidResponse(),
            ]),
          ),
        }),
  }
}

export function flowCheck(value: unknown): FlowCheck {
  const source = record(value)
  if (source.version != 1 || typeof source.valid != 'boolean' || !Array.isArray(source.diagnostics)) return invalidResponse()
  return {
    closureDigest: string(source.closureDigest),
    diagnostics: source.diagnostics.map(diagnostic),
    engineContract: string(source.engineContract),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    revisionDigest: string(source.revisionDigest),
    revisionId: string(source.revisionId),
    valid: source.valid,
    version: 1,
  }
}
