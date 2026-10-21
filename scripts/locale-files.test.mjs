import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const repositoryRoot = new URL('..', import.meta.url)

/**
 * Object keys that appear more than once in raw JSON text, reported as `path.to.key`. `JSON.parse`
 * keeps the last duplicate and drops the rest without complaining, so the text is scanned instead.
 */
function duplicateJsonKeys(source) {
  const duplicates = []
  const stack = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    const frame = stack.at(-1)
    if (character == '"') {
      const start = index
      index += 1
      while (index < source.length && source[index] != '"') index += source[index] == '\\' ? 2 : 1
      index += 1
      const text = JSON.parse(source.slice(start, index))
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

const localePaths = []
for await (const path of glob(['packages/open-flow/src/**/locales/*.json', 'apps/server/browser/locales/*.json'], { cwd: repositoryRoot }))
  localePaths.push(path.replaceAll('\\', '/'))
localePaths.sort()

describe('Locale files', () => {
  it('finds product and Server locale bundles', () => {
    for (const prefix of ['packages/open-flow/', 'apps/server/']) assert.ok(localePaths.some((path) => path.startsWith(prefix)))
  })

  it('reports duplicate keys with their path', () => {
    assert.deepEqual(duplicateJsonKeys('{"a": {"b": 1, "b": 2}, "a": 3}'), ['a.b', 'a'])
    assert.deepEqual(duplicateJsonKeys('{"a\\"b": 1, "a\\"b": 2}'), ['a"b'])
    assert.deepEqual(duplicateJsonKeys('{"a": "{\\"b\\": 1, \\"b\\": 2}"}'), [])
    assert.deepEqual(duplicateJsonKeys('{"list": [{"a": 1}, {"a": 1}], "a": 1}'), [])
  })

  for (const path of localePaths) {
    it(`never repeats a key in ${path}`, async () => {
      assert.deepEqual(duplicateJsonKeys(await readFile(new URL(path, repositoryRoot), 'utf8')), [])
    })
  }
})
