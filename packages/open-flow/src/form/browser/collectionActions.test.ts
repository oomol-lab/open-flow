import { describe, expect, it, vi } from 'vitest'
import { collectionCreateAction, objectFieldAdder } from './collectionActions.ts'

const base = { label: 'field', path: '/field', onDraftIssue: () => {} }

describe('collection creation', () => {
  it('creates a JSON placeholder for an unconstrained array item', () => {
    const onChange = vi.fn()
    collectionCreateAction({ ...base, schema: { type: 'array' }, value: undefined, onChange })?.()
    expect(onChange).toHaveBeenCalledExactlyOnceWith([null])
  })
  it.each([null, undefined])('adds the first array item from %s without mutating on inspection', (value) => {
    const onChange = vi.fn()
    const create = collectionCreateAction({ ...base, schema: { type: 'array', items: { type: 'string' } }, value, onChange })
    expect(onChange).not.toHaveBeenCalled()
    create?.()
    expect(onChange).toHaveBeenCalledWith([''])
  })

  it('adds an object field with its definition in one commit', () => {
    const onChange = vi.fn()
    const onDefinitionChange = vi.fn()
    objectFieldAdder({ ...base, schema: { type: 'object' }, value: {}, onChange, onDefinitionChange })()
    expect(onChange).not.toHaveBeenCalled()
    expect(onDefinitionChange).toHaveBeenCalledWith({ 'type': 'object', 'properties': { field: { type: 'string' } }, 'ui:order': ['field'] }, { field: '' })
  })

  it('respects read-only, array limits, and closed object definitions', () => {
    const onChange = vi.fn()
    const props = { ...base, schema: { type: 'array', maxItems: 0 }, value: undefined, onChange }
    expect(collectionCreateAction(props)).toBeUndefined()
    expect(collectionCreateAction({ ...props, schema: { type: 'object' }, disabled: true })).toBeUndefined()
    expect(collectionCreateAction({ ...props, schema: { type: 'object' }, valueEditable: false })).toBeUndefined()
    collectionCreateAction({ ...props, schema: { type: 'object', additionalProperties: false } })?.()
    expect(onChange).toHaveBeenCalledWith({})
  })
})

it.each([null, undefined])('materializes an object from %s without adding fields or applying child defaults', (value) => {
  const schema = { type: 'object', properties: { field: { type: 'string', default: 'default' }, count: { type: 'number' } } }
  const onChange = vi.fn()
  const onDefinitionChange = vi.fn()
  collectionCreateAction({ ...base, schema, value, nullable: true, onChange, onDefinitionChange })?.()
  expect(onChange).toHaveBeenCalledExactlyOnceWith({})
  expect(onDefinitionChange).not.toHaveBeenCalled()
  expect(Object.keys(schema.properties)).toEqual(['field', 'count'])
})
