import { describe, expect, it } from 'vitest'
import { compareJSONSchema, normalizeNullableSchemaPath } from '../../src/manifest/common/schemaCompare.ts'

describe('In-process schema compare', () => {
  it('uses the extracted comparer for compatible and incompatible schemas', () => {
    expect(compareJSONSchema({ schema: { type: 'string' }, packageId: undefined }, { schema: { type: 'string' }, packageId: undefined })).toEqual({
      kind: 'compatible',
    })
    expect(compareJSONSchema({ schema: { type: 'string' }, packageId: undefined }, { schema: { type: 'number' }, packageId: undefined })).toEqual({
      kind: 'incompatible',
      error: undefined,
      errorPath: ['type'],
    })
    expect(compareJSONSchema({ schema: { type: 'string' }, packageId: undefined }, { schema: { type: 'string', minLength: 1 }, packageId: undefined })).toEqual(
      { kind: 'incompatible', error: undefined, errorPath: ['minLength'] },
    )
    expect(
      compareJSONSchema(
        { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, packageId: undefined },
        { schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] }, packageId: undefined },
      ),
    ).toEqual({ kind: 'incompatible', error: undefined, errorPath: ['properties', 'name', 'minLength'] })
    expect(
      compareJSONSchema(
        { schema: { type: 'boolean' }, packageId: undefined },
        { schema: { anyOf: [{ type: 'string' }, { type: 'number' }] }, packageId: undefined },
      ),
    ).toEqual({ kind: 'incompatible', error: undefined, errorPath: ['anyOf', 1, 'type'] })
  })

  it('fails closed when schema compilation throws', () => {
    const schema = Object.defineProperty({}, 'type', {
      enumerable: true,
      get() {
        throw new Error('broken schema getter')
      },
    })

    expect(compareJSONSchema({ schema, packageId: undefined }, { schema: { type: 'string' }, packageId: undefined })).toEqual({
      kind: 'compare-error',
      message: 'broken schema getter',
    })
  })

  it('normalizes paths from nullable comparison wrappers', () => {
    expect(normalizeNullableSchemaPath(undefined, true)).toBeUndefined()
    expect(normalizeNullableSchemaPath([], true)).toEqual([])
    expect(normalizeNullableSchemaPath(['anyOf', 0, 'minLength'], true)).toEqual(['minLength'])
    expect(normalizeNullableSchemaPath(['anyOf', 1, 'type'], true)).toBeUndefined()
    expect(normalizeNullableSchemaPath(['anyOf', 1, 'type'], false)).toEqual(['anyOf', 1, 'type'])
  })
})
