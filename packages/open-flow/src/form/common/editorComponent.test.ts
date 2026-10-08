import { describe, expect, it } from 'vitest'
import { defaultValueEditorSchema, editorComponent, schemaForEditor, valueForEditor } from './editorComponent.ts'

describe('Editor component selection', () => {
  it('keeps text when switching between single line and multiline', () => {
    const schema = schemaForEditor('text', { type: 'string' })
    expect(schema).toEqual({ 'type': 'string', 'ui:widget': 'text' })
    expect(valueForEditor(schema, 'hello')).toBe('hello')
    expect(valueForEditor(schema, undefined)).toBeUndefined()
  })
  it('defaults new arrays to single-line text items and preserves existing item definitions', () => {
    expect(schemaForEditor('array', {})).toEqual({ type: 'array', items: { type: 'string' } })
    for (const schema of [{ type: 'array', items: { type: 'number' } }, { type: 'array' }]) {
      expect(schemaForEditor('array', schema)).toEqual(schema)
    }
  })
  it('carries choices between single and multiple select and filters invalid values', () => {
    const schema = schemaForEditor('multiSelect', { enum: ['a', 'b'] })
    expect(schema).toEqual({ type: 'array', uniqueItems: true, items: { enum: ['a', 'b'] } })
    expect(valueForEditor(schema, ['a', 'c'])).toEqual(['a'])
    expect(valueForEditor(schema, 'b')).toEqual(['b'])
    expect(schemaForEditor('select', schema)).toEqual({ enum: ['a', 'b'] })
  })
  it('removes stale component constraints when choosing a different kind', () => {
    const schema = schemaForEditor('number', { type: 'string', format: 'date', enum: ['2026-01-01'], description: 'Keep me' })
    expect(schema).toEqual({ type: 'number', description: 'Keep me' })
    expect(valueForEditor(schema, 'abc')).toBe(0)
  })
  it.each([
    ['date', 'date'],
    ['time', 'time'],
    ['date-time', 'dateTime'],
  ] as const)('recognizes %s', (format, component) => {
    expect(editorComponent({ type: 'string', format })).toBe(component)
  })
  it('preserves the current schema when selecting the same component', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    expect(schemaForEditor('object', schema)).toEqual(schema)
  })
  it('uses an unconstrained schema as the canonical JSON definition', () => {
    expect(schemaForEditor('json', { type: 'string' })).toEqual({})
    expect(schemaForEditor('json', { type: 'object', title: 'Payload', description: 'Any JSON value.' })).toEqual({
      title: 'Payload',
      description: 'Any JSON value.',
    })
    expect(schemaForEditor('json', { 'title': 'Payload', 'ui:widget': 'any' })).toEqual({ title: 'Payload' })
    expect(editorComponent({ 'ui:widget': 'any' })).toBe('json')
  })
  it.each(['text', 'color', 'date', 'time', 'dateTime'] as const)('creates a usable %s value without changing the fixed definition', (component) => {
    const schema = schemaForEditor(component, {})
    const created = valueForEditor(schema, undefined, { createIfUnset: true })
    expect(typeof created).toBe('string')
    if (component !== 'text') expect(valueForEditor(schema, 42)).toBeTruthy()
    expect(valueForEditor(schema, 42)).not.toBe(42)
    expect(valueForEditor(schema, 'existing', { createIfUnset: true })).toBe('existing')
  })
  it('keeps choice editing available without options', () => {
    expect(valueForEditor(schemaForEditor('select', {}), undefined, { createIfUnset: true })).toBeUndefined()
    expect(valueForEditor(schemaForEditor('multiSelect', {}), undefined, { createIfUnset: true })).toEqual([])
  })
  it('creates and converts values from an explicit data-type choice', () => {
    expect(valueForEditor({ type: 'string' }, undefined, { createIfUnset: true })).toBe('')
    expect(valueForEditor({ type: 'number' }, undefined, { createIfUnset: true })).toBe(0)
    expect(valueForEditor({ type: 'array' }, undefined, { createIfUnset: true })).toEqual([])
    expect(valueForEditor({ type: 'object' }, { answer: 42 })).toEqual({ answer: 42 })
    expect(valueForEditor({ type: 'boolean' }, 'true')).toBe(false)
    expect(valueForEditor({ type: 'null' }, 'value')).toBeNull()
  })
  it('preserves unset definitions while explicit creation honors schema defaults', () => {
    const schema = { type: 'object', default: { answer: 42 } }
    expect(valueForEditor(schema, undefined)).toBeUndefined()
    const created = valueForEditor(schema, undefined, { createIfUnset: true })
    expect(created).toEqual(schema.default)
    expect(created).not.toBe(schema.default)
    expect(valueForEditor(schema, 'incompatible')).toEqual(schema.default)
  })
  it('uses the underlying JSON type when resetting a typed raw editor', () => {
    const schema = { 'type': 'number', 'ui:widget': 'any' }
    expect(valueForEditor(schema, 42)).toBe(42)
    expect(valueForEditor(schema, 'incompatible')).toBe(0)
    expect(valueForEditor(schema, undefined)).toBeUndefined()
  })
})

describe('Default JSON value editor', () => {
  it.each([true, {}, { type: [] }, { 'ui:widget': 'any' }, { anyOf: [{ type: 'number' }, { type: 'string' }] }, { $ref: '#/unknown' }])(
    'falls back to single-line text for %j without resolving the schema',
    (schema) => {
      expect(editorComponent(defaultValueEditorSchema(schema))).toBe('string')
    },
  )
  it.each([
    [{ 'type': ['null', 'number'], 'ui:widget': 'any' }, 'number'],
    [{ type: ['null'] }, 'null'],
    [{ 'type': 'string', 'format': 'date', 'ui:widget': 'any' }, 'date'],
    [{ properties: { name: { type: 'string' } } }, 'object'],
    [{ items: { type: 'string' } }, 'array'],
  ])('uses straightforward hints in %j', (schema, component) => {
    const original = structuredClone(schema)
    expect(editorComponent(defaultValueEditorSchema(schema))).toBe(component)
    expect(schema).toEqual(original)
  })
})
