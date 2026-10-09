import { expect, it } from 'vitest'
it('requires inline syntax for values that resemble options', async () => {
  const { parseArguments } = await import('./arguments.ts')
  expect(() => parseArguments(['edit', 'flow', '--input', '--x=y'])).toThrow('--input requires a value.')
  expect(parseArguments(['edit', 'flow', '--input=--x=y']).input).toBe('--x=y')
  expect(() => parseArguments(['list', '--json=true'])).toThrow(/does not accept a value/)
})
