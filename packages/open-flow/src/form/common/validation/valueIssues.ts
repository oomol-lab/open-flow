import type { ErrorObject } from 'ajv'

import { compile, validate } from './validator.ts'

export interface ValueIssues {
  readonly errors: readonly ErrorObject[]
  readonly schemaError: boolean
}

/** Keep validation asynchronous and copy AJV's mutable errors before another field uses it. */
export async function valueIssues(schema: unknown, value: unknown, language: string, signal: AbortSignal): Promise<ValueIssues | undefined> {
  await Promise.resolve()
  if (signal.aborted) return
  const [validator, error] = compile(schema)
  const result = { schemaError: error != null, errors: structuredClone(validate(validator, value, language) ?? []) }
  return signal.aborted ? undefined : result
}
