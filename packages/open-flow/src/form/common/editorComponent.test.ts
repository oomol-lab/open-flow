import { describe, expect, it } from 'vitest'
import { editorComponent, schemaForEditor, valueForDataType, valueForEditor } from './editorComponent.ts'

describe('Editor component selection', () => {
  it('keeps text when switching between single line and multiline', () => {
    const schema = schemaForEditor('text', { type: 'string' })
    expect(schema).toEqual({ 'type': 'string', 'ui:widget': 'text' })
    expect(valueForEditor(schema, 'hello')).toBe('hello')
    expect(valueForEditor(schema, undefined)).toBeUndefined()
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
  it('creates and converts values from an explicit data-type choice', () => {
    expect(valueForDataType('string', undefined)).toBe('')
    expect(valueForDataType('number', undefined)).toBe(0)
    expect(valueForDataType('array', undefined)).toEqual([])
    expect(valueForDataType('object', { answer: 42 })).toEqual({ answer: 42 })
    expect(valueForDataType('boolean', 'true')).toBe(false)
    expect(valueForDataType('null', 'value')).toBeNull()
  })
})
