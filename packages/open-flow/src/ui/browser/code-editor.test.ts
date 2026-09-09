import { describe, expect, it } from 'vitest'
import { canonicalizeCodeMirrorLanguage } from './code-editor.ts'

describe('canonicalizeCodeMirrorLanguage', () => {
  it.each([
    ['javascript', 'javascript'],
    ['JSX', 'javascript'],
    ['text/javascript', 'javascript'],
    ['json', 'json'],
    ['application/json', 'json'],
    ['markdown', 'markdown'],
    ['MDX', 'markdown'],
    ['typescript', 'typescript'],
    ['TSX', 'typescript'],
    ['text/typescript', 'typescript'],
    ['yaml', 'yaml'],
    ['YML', 'yaml'],
    ['text/yaml', 'yaml'],
    ['application/yaml', 'yaml'],
    ['plaintext', 'plaintext'],
    ['unknown', 'plaintext'],
  ] as const)('maps %s to %s', (language, expected) => {
    expect(canonicalizeCodeMirrorLanguage(language)).toBe(expected)
  })
})
