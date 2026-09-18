import { describe, expect, it } from 'vitest'
import { comparePorts } from '../../src/flow/common/schema.ts'
import { compareJSONSchema, normalizeNullableSchemaPath } from '../../src/manifest/common/schemaCompare.ts'

const port = (jsonSchema: Parameters<typeof comparePorts>[0]['jsonSchema'], nullable = false) => ({ handle: 'value', jsonSchema, nullable })

describe('Port compatibility diagnostics', () => {
  it('treats the JSON editor schema as accepting any upstream JSON value', () => {
    expect(comparePorts(port({}, true), port({ 'ui:widget': 'any' }, true))).toEqual({ kind: 'compatible' })
    expect(comparePorts(port({ type: 'object' }), port({ 'title': 'Payload', 'description': 'Any JSON value.', 'ui:widget': 'any' }))).toEqual({
      kind: 'compatible',
    })
    expect(comparePorts(port({ 'ui:widget': 'any' }), port({ type: 'object' }))).toEqual({
      kind: 'incompatible',
      mismatch: { kind: 'keyword', keyword: 'type', path: [], source: undefined, target: 'object' },
    })
  })

  it('describes a root type mismatch even when a nullable wrapper hides the comparison path', () => {
    expect(comparePorts(port({ type: 'string' }), port({ type: 'number' }, true))).toEqual({
      kind: 'incompatible',
      mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' },
    })
  })

  it('describes nested constraints and missing required properties', () => {
    expect(
      comparePorts(
        port({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
        port({ type: 'object', properties: { name: { type: 'string', minLength: 2 } }, required: ['name'] }),
      ),
    ).toEqual({
      kind: 'incompatible',
      mismatch: { kind: 'keyword', keyword: 'minLength', path: ['properties', 'name'], source: undefined, target: 2 },
    })
    expect(comparePorts(port({ type: 'object', properties: { name: { type: 'string' } } }), port({ type: 'object', required: ['name'] }))).toEqual({
      kind: 'incompatible',
      mismatch: { kind: 'keyword', keyword: 'required', path: [], source: undefined, target: ['name'] },
    })
  })

  it('distinguishes nullable and special data mismatches', () => {
    expect(comparePorts(port({ type: 'string' }, true), port({ type: 'string' }))).toEqual({ kind: 'incompatible', mismatch: { kind: 'nullable' } })
    expect(comparePorts(port({ contentMediaType: 'oomol/bin', type: 'string' }), port({ type: 'string' }))).toEqual({
      kind: 'incompatible',
      mismatch: { kind: 'binary' },
    })
  })
})

describe('In-process schema compare', () => {
  it('compares ui-only schemas as directional unconstrained schemas', () => {
    expect(compareJSONSchema({ schema: { 'ui:widget': 'any' }, packageId: undefined }, { schema: { type: 'object' }, packageId: undefined })).toEqual({
      kind: 'incompatible',
      error: undefined,
      errorPath: ['type'],
    })
    expect(compareJSONSchema({ schema: { type: 'object' }, packageId: undefined }, { schema: { 'ui:widget': 'any' }, packageId: undefined })).toEqual({
      kind: 'compatible',
    })
  })

  it('ignores ui-prefixed keywords at every schema level', () => {
    expect(
      compareJSONSchema(
        {
          schema: {
            'type': 'object',
            'properties': {
              'payload': { 'type': 'string', 'ui:widget': 'text', 'ui:options': { rows: 4 } },
              'ui:value': { type: 'number' },
            },
            'required': ['payload', 'ui:value'],
            'ui:order': ['payload', 'ui:value'],
          },
          packageId: undefined,
        },
        {
          schema: {
            type: 'object',
            properties: { 'payload': { type: 'string' }, 'ui:value': { type: 'number' } },
            required: ['payload', 'ui:value'],
          },
          packageId: undefined,
        },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('compares nested unconstrained schemas directionally', () => {
    const anyProperty = { type: 'object', properties: { payload: {} }, required: ['payload'] }
    const stringProperty = { type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'] }
    const anyItems = { type: 'array', items: {} }
    const stringItems = { type: 'array', items: { type: 'string' } }

    expect(compareJSONSchema({ schema: stringProperty, packageId: undefined }, { schema: anyProperty, packageId: undefined })).toEqual({ kind: 'compatible' })
    expect(compareJSONSchema({ schema: anyProperty, packageId: undefined }, { schema: stringProperty, packageId: undefined })).toMatchObject({
      kind: 'incompatible',
      errorPath: ['properties', 'payload', 'type'],
    })
    expect(compareJSONSchema({ schema: stringItems, packageId: undefined }, { schema: anyItems, packageId: undefined })).toEqual({ kind: 'compatible' })
    expect(compareJSONSchema({ schema: anyItems, packageId: undefined }, { schema: stringItems, packageId: undefined })).toMatchObject({
      kind: 'incompatible',
      errorPath: ['items', 'type'],
    })
  })

  it.each([
    [{ type: 'array', contains: { type: 'string' } }, '#/contains'],
    [{ type: 'object', dependentRequired: { name: ['id'] } }, '#/dependentRequired'],
    [{ type: 'object', properties: { payload: { unevaluatedProperties: false } } }, '#/properties/payload/unevaluatedProperties'],
  ])('fails closed for unsupported comparison constraints in %j', (schema, path) => {
    expect(compareJSONSchema({ schema, packageId: undefined }, { schema: {}, packageId: undefined })).toEqual({
      kind: 'compare-error',
      message: `Unsupported schema comparison keyword at ${path}.`,
    })
  })

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

  it('resolves local schema references before comparison', () => {
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: { email: { format: 'email', type: 'string' } },
            $ref: '#/$defs/email',
            description: 'Email address.',
          },
        },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        { packageId: undefined, schema: { definitions: { count: { type: 'integer' } }, $ref: '#/definitions/count' } },
        { packageId: undefined, schema: { type: 'number' } },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        {
          nullable: true,
          packageId: undefined,
          schema: { $defs: { email: { type: 'string' } }, $ref: '#/$defs/email' },
        },
        { nullable: true, packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('fails closed for an invalid local schema reference', () => {
    expect(compareJSONSchema({ packageId: undefined, schema: { $ref: '#/$defs/missing' } }, { packageId: undefined, schema: { type: 'string' } })).toEqual({
      kind: 'compare-error',
      message: 'Local JSON Schema reference "#/$defs/missing" does not exist.',
    })
  })

  it('normalizes paths from nullable comparison wrappers', () => {
    expect(normalizeNullableSchemaPath(undefined, true)).toBeUndefined()
    expect(normalizeNullableSchemaPath([], true)).toEqual([])
    expect(normalizeNullableSchemaPath(['anyOf', 0, 'minLength'], true)).toEqual(['minLength'])
    expect(normalizeNullableSchemaPath(['anyOf', 1, 'type'], true)).toBeUndefined()
    expect(normalizeNullableSchemaPath(['anyOf', 1, 'type'], false)).toEqual(['anyOf', 1, 'type'])
  })

  it.each([
    {
      from: { minLength: 2, type: 'string' },
      kind: 'compatible',
      name: 'narrower string minimum',
      to: { minLength: 1, type: 'string' },
    },
    {
      from: { minLength: 1, type: 'string' },
      kind: 'incompatible',
      name: 'wider string minimum',
      to: { minLength: 2, type: 'string' },
    },
    {
      from: { maxLength: 5, pattern: '^a', type: 'string' },
      kind: 'compatible',
      name: 'narrower string maximum and pattern',
      to: { maxLength: 10, type: 'string' },
    },
    {
      from: { type: 'string' },
      kind: 'incompatible',
      name: 'missing target pattern guarantee',
      to: { pattern: '^a', type: 'string' },
    },
    { from: { format: 'email', type: 'string' }, kind: 'compatible', name: 'formatted string to plain string', to: { type: 'string' } },
    { from: { type: 'string' }, kind: 'incompatible', name: 'plain string to formatted string', to: { format: 'email', type: 'string' } },
    { from: { type: 'integer' }, kind: 'compatible', name: 'integer to number', to: { type: 'number' } },
    { from: { type: 'number' }, kind: 'incompatible', name: 'number to integer', to: { type: 'integer' } },
    {
      from: { maximum: 5, minimum: 2, type: 'number' },
      kind: 'compatible',
      name: 'narrower number range',
      to: { maximum: 10, minimum: 1, type: 'number' },
    },
    {
      from: { items: { minLength: 2, type: 'string' }, minItems: 2, type: 'array' },
      kind: 'compatible',
      name: 'narrower array and items',
      to: { items: { type: 'string' }, minItems: 1, type: 'array' },
    },
    {
      from: { items: { type: 'string' }, type: 'array' },
      kind: 'incompatible',
      name: 'wider array items',
      to: { items: { minLength: 2, type: 'string' }, type: 'array' },
    },
    {
      from: { items: { type: 'string' }, minItems: 1, type: 'array', uniqueItems: true },
      kind: 'compatible',
      name: 'unique array to ordinary array',
      to: { items: { type: 'string' }, minItems: 1, type: 'array' },
    },
    {
      from: { items: { type: 'string' }, minItems: 1, type: 'array' },
      kind: 'incompatible',
      name: 'ordinary array to unique array',
      to: { items: { type: 'string' }, minItems: 1, type: 'array', uniqueItems: true },
    },
    {
      from: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
      kind: 'compatible',
      name: 'required source property',
      to: { properties: { name: { type: 'string' } }, type: 'object' },
    },
    {
      from: { properties: { name: { type: 'string' } }, type: 'object' },
      kind: 'incompatible',
      name: 'missing required target property',
      to: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
    },
    {
      from: { additionalProperties: false, properties: { name: { type: 'string' } }, type: 'object' },
      kind: 'compatible',
      name: 'closed source object',
      to: { properties: { name: { type: 'string' } }, type: 'object' },
    },
    {
      from: { properties: { name: { type: 'string' } }, type: 'object' },
      kind: 'incompatible',
      name: 'open source object to closed target',
      to: { additionalProperties: false, properties: { name: { type: 'string' } }, type: 'object' },
    },
    {
      from: { allOf: [{ type: 'string' }, { minLength: 2, type: 'string' }] },
      kind: 'compatible',
      name: 'allOf string restriction',
      to: { type: 'string' },
    },
    {
      from: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      kind: 'compatible',
      name: 'oneOf to matching anyOf',
      to: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    },
    {
      from: { oneOf: [{ type: 'string' }] },
      kind: 'compatible',
      name: 'single-branch oneOf to a matching type',
      to: { type: 'string' },
    },
    {
      from: { oneOf: [{ type: 'string' }] },
      kind: 'incompatible',
      name: 'single-branch oneOf to a mismatched type',
      to: { type: 'number' },
    },
    {
      from: { oneOf: [{ maxLength: 0, minLength: 1, type: 'string' }, { type: 'number' }] },
      kind: 'incompatible',
      name: 'oneOf with a never branch to a mismatched type',
      to: { type: 'boolean' },
    },
    { from: { type: 'string' }, kind: 'compatible', name: 'string outside a numeric not', to: { not: { type: 'number' } } },
    { from: { not: { type: 'number' } }, kind: 'incompatible', name: 'numeric not wider than string', to: { type: 'string' } },
  ])('compares $name directionally', ({ from, kind, to }) => {
    expect(compareJSONSchema({ packageId: undefined, schema: from }, { packageId: undefined, schema: to })).toMatchObject({ kind })
  })

  it('resolves chained, nested, escaped and target-side local references', () => {
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: {
              alias: { $ref: '#/$defs/text' },
              text: { minLength: 2, type: 'string' },
            },
            $ref: '#/$defs/alias',
          },
        },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: { 'mail/address~text': { type: 'string' } },
            properties: { email: { $ref: '#/$defs/mail~1address~0text' } },
            required: ['email'],
            type: 'object',
          },
        },
        {
          packageId: undefined,
          schema: { properties: { email: { type: 'string' } }, required: ['email'], type: 'object' },
        },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        { packageId: undefined, schema: { minLength: 2, type: 'string' } },
        { packageId: undefined, schema: { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text' } },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        { packageId: undefined, schema: { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text', minLength: 2, type: 'string' } },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('decodes URI fragments before evaluating JSON Pointers', () => {
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: { group: { text: { type: 'string' } } },
            $ref: '#/$defs/group%2Ftext',
          },
        },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('preserves literal objects containing $ref keys', () => {
    const literal = { $ref: '#/$defs/text' }

    expect(
      compareJSONSchema(
        { packageId: undefined, schema: { $defs: { text: { type: 'string' } }, const: literal } },
        { packageId: undefined, schema: { const: literal } },
      ),
    ).toEqual({ kind: 'compatible' })
    expect(
      compareJSONSchema(
        { packageId: undefined, schema: { $defs: { text: { type: 'string' } }, enum: [literal] } },
        { packageId: undefined, schema: { enum: [literal] } },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('allows a $ref sibling to repeat a reference', () => {
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: { text: { type: 'string' } },
            $ref: '#/$defs/text',
            allOf: [{ $ref: '#/$defs/text' }],
          },
        },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compatible' })
  })

  it('fails closed for cyclic local references', () => {
    expect(
      compareJSONSchema(
        {
          packageId: undefined,
          schema: {
            $defs: {
              first: { $ref: '#/$defs/second' },
              second: { $ref: '#/$defs/first' },
            },
            $ref: '#/$defs/first',
          },
        },
        { packageId: undefined, schema: { type: 'string' } },
      ),
    ).toEqual({ kind: 'compare-error', message: 'Cyclic local JSON Schema reference "#/$defs/first".' })
  })
})
