import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PackageSchema } from '../src/schema/index.ts'

test('accepts the local project descriptor', () => {
  assert.deepEqual(PackageSchema.parse({ name: 'example', displayName: 'Example', description: 'Local workflow', icon: ':carbon:flow:' }), {
    name: 'example',
    displayName: 'Example',
    description: 'Local workflow',
    icon: ':carbon:flow:',
  })
})

test('accepts an empty descriptor and rejects unknown fields', () => {
  assert.deepEqual(PackageSchema.parse({}), {})
  assert.equal(PackageSchema.safeParse({ name: 'example', unknown: true }).success, false)
})
