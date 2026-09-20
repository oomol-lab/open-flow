import { describe, expect, it } from 'vitest'
import { valueFieldExpansion } from './fieldExpansion.ts'
import { fieldValueShape, fieldValueState, setArrayItem } from './fieldValue.ts'
import { objectFieldNames, removeFieldDefinition, renameFieldDefinition } from './objectFields.ts'

describe('field presence and actions', () => {
  it.each([
    [true, undefined, 'null', false],
    [true, null, 'null', false],
    [true, '', 'value', true],
    [false, undefined, 'unset', false],
    [false, null, 'null', true],
    [false, false, 'value', true],
  ] as const)('nullable=%s value=%s displays %s, clear=%s', (nullable, value, display, canClear) => {
    expect(fieldValueState({ type: 'string' }, value, nullable)).toMatchObject({ display, canClear })
  })
  it.each([undefined, null, '', {}, []])('recognizes an empty value %s', (value) => {
    expect(fieldValueState({}, value).empty).toBe(true)
  })
  it.each([false, 0, ' ', [null], { field: undefined }])('does not conflate a populated value %s with empty', (value) => {
    expect(fieldValueState({}, value).empty).toBe(false)
  })
  it('keeps schema nullability and stored null validation separate from presence', () => {
    expect(fieldValueState({ type: ['string', 'null'] }, undefined)).toMatchObject({ display: 'null', missing: false })
    expect(fieldValueState({ type: 'string' }, null)).toMatchObject({ presence: 'null', invalidNull: true })
  })
  it('clears an array item without deleting its position or mutating the source', () => {
    const values = [1, 2, 3]
    expect(setArrayItem(values, 1, undefined)).toEqual([1, null, 3])
    expect(values).toEqual([1, 2, 3])
  })
})

describe('initial field expansion policy', () => {
  it('defers a populated field until validation, while opening editable empty fields', () => {
    expect(valueFieldExpansion({ expandable: true, editable: true, empty: false, validation: 'pending' })).toBeUndefined()
    expect(valueFieldExpansion({ expandable: true, editable: true, empty: true, validation: 'pending' })).toBe(true)
  })
  it('does not expand read-only empty fields or invent children for scalar inputs', () => {
    expect(valueFieldExpansion({ expandable: true, editable: false, empty: true, validation: 'valid' })).toBe(false)
    expect(valueFieldExpansion({ expandable: false, editable: true, empty: true, validation: 'invalid' })).toBe(false)
  })
  it('opens initial errors, including read-only fields', () => {
    expect(valueFieldExpansion({ expandable: true, editable: false, empty: false, validation: 'invalid' })).toBe(true)
  })
  it('keeps an empty top-level JSON field collapsed unless its initial validation fails', () => {
    const field = { component: 'json', depth: 0, expandable: true, editable: true, empty: true } as const
    expect(valueFieldExpansion({ ...field, validation: 'pending' })).toBeUndefined()
    expect(valueFieldExpansion({ ...field, validation: 'valid' })).toBe(false)
    expect(valueFieldExpansion({ ...field, validation: 'invalid' })).toBe(true)
    expect(valueFieldExpansion({ ...field, depth: 1, validation: 'valid' })).toBe(true)
  })
})

describe('field value shape', () => {
  it('uses the inferred editor component as the choice authority', () => {
    expect(fieldValueShape({ type: 'array', uniqueItems: true, items: { type: 'string' } }, [])).toMatchObject({
      choiceOptions: undefined,
      collection: true,
    })
    expect(fieldValueShape({ type: 'array', uniqueItems: true, items: { enum: ['one', 'two'] } }, [])).toMatchObject({
      choiceOptions: ['one', 'two'],
      collection: false,
    })
    expect(fieldValueShape({ 'type': 'array', 'ui:widget': 'multiSelect', 'items': { type: 'string' } }, [])).toMatchObject({
      choiceOptions: [],
      collection: false,
    })
  })
  it.each([
    ['text', 'hello', false, false],
    ['number', 3, false, false],
    ['boolean', true, false, false],
    ['null', null, false, false],
    ['object', { answer: 42 }, false, true],
    ['array', ['answer'], false, true],
  ] as const)('uses the runtime %s value shape for an unconstrained schema', (_name, value, complex, collection) => {
    expect(fieldValueShape({}, value)).toMatchObject({ unconstrained: true, complex, collection })
  })
  it('keeps constrained and compound JSON schemas in the JSON editor', () => {
    expect(fieldValueShape({ minLength: 1 }, 'value')).toMatchObject({ unconstrained: false, complex: true, collection: false })
    expect(fieldValueShape({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 'value')).toMatchObject({
      unconstrained: false,
      complex: true,
      collection: false,
    })
  })
})

it('renames and removes a definition together with order and required membership', () => {
  const schema = { 'type': 'object', 'properties': { first: { type: 'string' }, second: {} }, 'required': ['first'], 'ui:order': ['second', 'first'] }
  const renamed = renameFieldDefinition(schema, 'first', 'renamed')!
  expect(objectFieldNames(renamed)).toEqual(['second', 'renamed'])
  expect(renamed.required).toEqual(['renamed'])
  expect(renameFieldDefinition(schema, 'first', 'second')).toBeUndefined()
  const removed = removeFieldDefinition(renamed, 'renamed')
  expect(removed.properties).toEqual({ second: {} })
  expect(removed.required).toEqual([])
  expect(objectFieldNames(removed)).toEqual(['second'])
  expect(schema.required).toEqual(['first'])
})

describe('Inline editor expansion', () => {
  it.each(['pending', 'valid', 'invalid'] as const)('keeps empty nested editors collapsed with %s validation', (validation) => {
    expect(valueFieldExpansion({ placement: 'inline', expandable: true, editable: true, empty: true, validation })).toBe(false)
  })
})
