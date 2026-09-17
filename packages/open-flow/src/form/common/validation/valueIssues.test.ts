import { describe, expect, it, vi } from 'vitest'
import { uiLanguages } from '../../../localization/common/languages.ts'
import { ajv } from './validator.ts'
import { valueIssues } from './valueIssues.ts'

const validate = (schema: unknown, value: unknown, language = 'en') => valueIssues(schema, value, language, new AbortController().signal)

describe('Value issue diagnostics', () => {
  it.each(uiLanguages)('includes localized constraints in %s', async (language) => {
    const result = await validate({ type: 'string', minLength: 8 }, 'short', language)
    expect(result?.errors[0]).toMatchObject({ keyword: 'minLength', params: { limit: 8 }, message: expect.stringContaining('8') })
    expect(result?.schemaError).toBe(false)
  })

  it('preserves nested paths and collection-level constraints', async () => {
    const result = await validate({ type: 'array', minItems: 2, items: { type: 'string', minLength: 8 } }, ['short'])
    expect(result?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: 'minItems', instancePath: '' }),
        expect.objectContaining({ keyword: 'minLength', instancePath: '/0' }),
      ]),
    )
  })

  it('does not validate a superseded request', async () => {
    const controller = new AbortController()
    const compile = vi.spyOn(ajv, 'compile')
    try {
      const pending = valueIssues({ type: 'string' }, 3, 'en', controller.signal)
      expect(compile).not.toHaveBeenCalled()
      controller.abort()
      expect(await pending).toBeUndefined()
      expect(compile).not.toHaveBeenCalled()
    } finally {
      compile.mockRestore()
    }
  })

  it('keeps earlier messages stable when a shared validator changes language or value', async () => {
    const schema = { type: 'string', minLength: 8 }
    const english = await validate(schema, 'short')
    const snapshot = structuredClone(english)
    const chinese = await validate(schema, 'short', 'zh-CN')
    expect(chinese?.errors[0]?.message).not.toEqual(english?.errors[0]?.message)
    expect((await validate(schema, 'long enough'))?.errors).toEqual([])
    expect(english).toEqual(snapshot)
  })

  it('reports malformed schemas without throwing', async () => {
    expect(await validate({ type: 'not-a-type' }, 'value')).toEqual({ schemaError: true, errors: [] })
  })
})
