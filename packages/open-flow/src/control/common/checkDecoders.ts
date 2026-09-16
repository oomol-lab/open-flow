import type { SchemaMismatch } from '../../flow/common/change.ts'
import type { Diagnostic, FlowCheck } from './api.ts'

import { isSchemaKeyword } from '../../flow/common/change.ts'
import { integer, invalidResponse, jsonValue, record, string } from './decoding.ts'

function schemaPath(value: unknown): readonly (string | number)[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map((part) => (typeof part == 'string' || Number.isSafeInteger(part) ? part : invalidResponse()))
}

function schemaMismatch(value: unknown): SchemaMismatch {
  const source = record(value)
  const kind = string(source.kind)
  if (kind == 'artifact' || kind == 'binary' || kind == 'nullable') return { kind }
  if (kind == 'schema') return { kind, path: source.path == null ? undefined : schemaPath(source.path) }
  if (kind != 'keyword' || typeof source.keyword != 'string' || !isSchemaKeyword(source.keyword)) return invalidResponse()
  return {
    kind,
    keyword: source.keyword,
    path: schemaPath(source.path),
    source: source.source === undefined ? undefined : jsonValue(source.source),
    target: source.target === undefined ? undefined : jsonValue(source.target),
  }
}

function diagnostic(value: unknown): Diagnostic {
  const source = record(value)
  const values = source.values == null ? undefined : record(source.values)
  return {
    code: string(source.code),
    column: integer(source.column),
    line: integer(source.line),
    message: string(source.message),
    mismatch: source.mismatch == null ? undefined : schemaMismatch(source.mismatch),
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
