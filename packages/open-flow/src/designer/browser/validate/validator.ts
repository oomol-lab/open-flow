import type { ErrorObject, Options, ValidateFunction } from 'ajv'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { localizeAjvErrors } from './ajvLocalize.ts'

/** Call this on top of the program. */
export function createAjv(options?: Options): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    addUsedSchema: false,
    ...options,
  })
  addFormats(ajv)
  return ajv
}

export const ajv: Ajv = /*#__PURE__*/ createAjv()

/** Call this on `schema` changed. */
export function compile(schema?: unknown): [ValidateFunction | undefined, Error | undefined] {
  if (!schema) {
    return [undefined, undefined]
  }
  try {
    return [ajv.compile(schema), undefined]
  } catch (e) {
    return [undefined, e as Error]
  }
}

/** Call this on `data` changed. This function ensures `error.message` exists. */
export function validate(fn: ValidateFunction | undefined, data: unknown, locale?: string): ErrorObject[] | null | undefined {
  if (!fn) return []
  if (fn(data)) return []
  localizeAjvErrors(locale, fn.errors)
  return fn.errors
}
