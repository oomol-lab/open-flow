import type { ValidateFunction } from 'ajv'
import type { ReadonlyVal } from 'value-enhancer'

import { compute, val } from 'value-enhancer'
import { compile, validate } from '../../form/common/validation/validator.ts'
import { isJsonValue, objectValue, setObjectField } from '../../form/common/value.ts'

export interface FlowRunInputDefinition {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema: unknown
  readonly nullable: boolean
}

export interface InputIssue {
  readonly kind: 'required' | 'schema' | 'json'
  readonly message?: string
}

/** Owns one explicit input snapshot. Schema validation never populates defaults or coerces values. */
export class FlowRunInputEditorStore {
  readonly #values = val<Readonly<Record<string, unknown>>>({})
  readonly #draftIssues = val<ReadonlySet<string>>(new Set())
  readonly #validators = new Map<string, readonly [ValidateFunction | undefined, Error | undefined]>()
  public readonly values$: ReadonlyVal<Readonly<Record<string, unknown>>> = this.#values
  public readonly issues$: ReadonlyVal<Readonly<Record<string, InputIssue>>>
  public readonly valid$: ReadonlyVal<boolean>

  public constructor(
    public readonly definitions: readonly FlowRunInputDefinition[],
    public readonly language: ReadonlyVal<string>,
  ) {
    for (const definition of definitions) this.#validators.set(definition.handle, compile(definition.jsonSchema))
    this.issues$ = compute((get) => {
      const values = get(this.#values)
      const locale = get(language)
      return Object.fromEntries(
        definitions.flatMap((definition): [string, InputIssue][] => {
          const value = values[definition.handle]
          if (!Object.hasOwn(values, definition.handle) || value === undefined) return [[definition.handle, { kind: 'required' as const }]]
          if (!isJsonValue(value)) return [[definition.handle, { kind: 'json' as const }]]
          if (value === null && definition.nullable) return []
          const [validator, error] = this.#validators.get(definition.handle)!
          const errors = error ? undefined : validate(validator, value, locale)
          const message = error?.message ?? errors?.map((item) => `${item.instancePath || '/'} ${item.message}`).join('; ')
          return message ? [[definition.handle, { kind: 'schema' as const, message }]] : []
        }),
      )
    })
    this.valid$ = compute((get) => Object.keys(get(this.issues$)).length == 0 && get(this.#draftIssues).size == 0)
  }

  public setValue(handle: string, value: unknown): void {
    if (!this.#validators.has(handle)) throw new Error('Unknown input handle.')
    if (value !== undefined && !isJsonValue(value)) throw new Error('Input values must be JSON.')
    this.#values.set(setObjectField(this.#values.value, handle, value))
  }

  public setDraftIssue = (path: string, invalid: boolean): void => {
    if (this.#draftIssues.value.has(path) == invalid) return
    const issues = new Set(this.#draftIssues.value)
    if (invalid) issues.add(path)
    else issues.delete(path)
    this.#draftIssues.set(issues)
  }

  public values(): Readonly<Record<string, unknown>> {
    return this.#values.value
  }

  public replaceValues(value: unknown): boolean {
    const object = objectValue(value)
    if (object == null || Object.keys(object).some((key) => !this.#validators.has(key))) return false
    const entries = Object.entries(object).filter(([, item]) => item !== undefined)
    if (entries.some(([, item]) => !isJsonValue(item))) return false
    this.#values.set(structuredClone(Object.fromEntries(entries)))
    this.#draftIssues.set(new Set())
    return true
  }

  public dispose(): void {
    this.valid$.dispose()
    this.issues$.dispose()
    this.#values.dispose()
    this.#draftIssues.dispose()
  }
}
