import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { FlowRunInputEditorStore } from './flowRunInputEditorStore.ts'

function editor(jsonSchema: unknown, nullable = false) {
  const language = val('en')
  const store = new FlowRunInputEditorStore([{ handle: 'payload', jsonSchema, nullable }], language)
  return {
    store,
    dispose: () => {
      store.dispose()
      language.dispose()
    },
  }
}

describe('FlowRunInputEditorStore', () => {
  it('requires explicit values, preserves null, and does not insert schema defaults', () => {
    const { store, dispose } = editor({ type: 'string', default: 'World' }, true)
    try {
      expect(store.values()).toEqual({})
      expect(store.valid$.value).toBe(false)
      store.setValue('payload', null)
      expect(store.valid$.value).toBe(true)
      expect(store.values()).toEqual({ payload: null })
      store.setValue('payload', undefined)
      expect(store.valid$.value).toBe(false)
      store.setValue('payload', '')
      expect(store.valid$.value).toBe(true)
    } finally {
      dispose()
    }
  })

  it('validates required nested fields and formats synchronously without idle callbacks', () => {
    const { store, dispose } = editor({
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
      additionalProperties: false,
    })
    try {
      store.replaceValues({ payload: {} })
      expect(store.valid$.value).toBe(false)
      store.setValue('payload', { email: 'invalid' })
      expect(store.valid$.value).toBe(false)
      store.setValue('payload', { email: 'user@example.com' })
      expect(store.valid$.value).toBe(true)
      store.setValue('payload', { email: 'user@example.com', extra: true })
      expect(store.valid$.value).toBe(false)
    } finally {
      dispose()
    }
  })

  it('keeps invalid text drafts from submitting previously valid values', () => {
    const { store, dispose } = editor({ type: 'number' })
    try {
      store.setValue('payload', 12)
      store.setDraftIssue('/payload', true)
      expect(store.values()).toEqual({ payload: 12 })
      expect(store.valid$.value).toBe(false)
      store.setDraftIssue('/payload', false)
      expect(store.valid$.value).toBe(true)
    } finally {
      dispose()
    }
  })

  it('rejects unknown fields and non-JSON replacements atomically', () => {
    const { store, dispose } = editor({})
    try {
      store.setValue('payload', 'before')
      for (const value of [[], { unknown: true }, { payload: Infinity }, { payload: new Date() }]) {
        expect(store.replaceValues(value)).toBe(false)
        expect(store.values()).toEqual({ payload: 'before' })
      }
    } finally {
      dispose()
    }
  })

  it.each([false, { type: 'invalid' }])('fails closed for a rejecting or invalid schema: %j', (schema) => {
    const { store, dispose } = editor(schema)
    try {
      store.setValue('payload', 'value')
      expect(store.valid$.value).toBe(false)
    } finally {
      dispose()
    }
  })
})
