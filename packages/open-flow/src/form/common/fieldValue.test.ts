import { describe, expect, it } from 'vitest'
import { valueFieldExpansion } from './fieldExpansion.ts'
import { fieldValueState, setArrayItem } from './fieldValue.ts'
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
