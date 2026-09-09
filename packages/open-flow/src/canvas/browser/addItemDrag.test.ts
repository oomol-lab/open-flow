import { describe, expect, it } from 'vitest'
import { getAddItemId, setAddItemId } from './addItemDrag.ts'

function transfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value)
    },
  } as unknown as DataTransfer
}

describe('add item drag payload', () => {
  it('stores only the session item identity as a copy payload', () => {
    const dataTransfer = transfer()

    setAddItemId(dataTransfer, 'connector:github:create-issue')

    expect(getAddItemId(dataTransfer)).toBe('connector:github:create-issue')
    expect(dataTransfer.effectAllowed).toBe('copy')
  })
})
