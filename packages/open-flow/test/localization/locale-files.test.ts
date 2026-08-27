import { glob, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../..', import.meta.url)

interface JsonFrame {
  readonly keys: Set<string>
  readonly kind: 'array' | 'object'
  pendingKey: string | undefined
  readonly prefix: string
}

/**
 * Object keys that appear more than once in raw JSON text, reported as `path.to.key`. `JSON.parse`
 * keeps the last duplicate and drops the rest without complaining, so the text is scanned instead.
 */
function duplicateJsonKeys(source: string): readonly string[] {
  const duplicates: string[] = []
  const stack: JsonFrame[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]!
    const frame = stack.at(-1)
    if (character == '"') {
      const start = index
      index += 1
      while (index < source.length && source[index] != '"') index += source[index] == '\\' ? 2 : 1
      index += 1
      const text = JSON.parse(source.slice(start, index)) as string
      if (frame != null && frame.kind == 'object' && frame.pendingKey == null) {
        if (frame.keys.has(text)) duplicates.push(`${frame.prefix}${text}`)
        frame.keys.add(text)
        frame.pendingKey = text
      }
      continue
    }
    if (character == '{' || character == '[') {
      const prefix = frame == null ? '' : frame.kind == 'object' ? `${frame.prefix}${frame.pendingKey}.` : frame.prefix
      stack.push({ keys: new Set(), kind: character == '{' ? 'object' : 'array', pendingKey: undefined, prefix })
    } else if (character == '}' || character == ']') {
      stack.pop()
    } else if (character == ',' && frame != null) {
      frame.pendingKey = undefined
    }
    index += 1
  }
  return duplicates
}

const localePaths: string[] = []
for await (const path of glob('src/**/locales/*.json', { cwd: packageRoot })) localePaths.push(path.replaceAll('\\', '/'))
localePaths.sort()

describe('Locale files', () => {
  it('finds every locale bundle in the package', () => {
    expect(localePaths.length).toBeGreaterThan(0)
  })

  it('reports duplicate keys with their path', () => {
    expect(duplicateJsonKeys('{"a": {"b": 1, "b": 2}, "a": 3}')).toEqual(['a.b', 'a'])
    expect(duplicateJsonKeys('{"a\\"b": 1, "a\\"b": 2}')).toEqual(['a"b'])
    expect(duplicateJsonKeys('{"a": "{\\"b\\": 1, \\"b\\": 2}"}')).toEqual([])
    expect(duplicateJsonKeys('{"list": [{"a": 1}, {"a": 1}], "a": 1}')).toEqual([])
  })

  for (const path of localePaths) {
    it(`never repeats a key in ${path}`, async () => {
      expect(duplicateJsonKeys(await readFile(new URL(path, packageRoot), 'utf8'))).toEqual([])
    })
  }
})
