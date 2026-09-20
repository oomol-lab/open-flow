import { expect, it } from 'vitest'
import { inputValue } from './inputValue.ts'

it.each([{}, [], 'default', 1, false, null])('distinguishes an explicit clear from inheriting %j', (fallback) => {
  expect(inputValue(undefined, fallback)).toEqual(fallback)
  expect(inputValue({ kind: 'unset' }, fallback)).toBeUndefined()
  expect(inputValue({ kind: 'value', value: null }, fallback)).toBeNull()
})
