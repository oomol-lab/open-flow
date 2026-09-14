import { describe, expect, it } from 'vitest'
import { movePort } from './portOrder.ts'

const a = { handle: 'a', jsonSchema: {}, nullable: false, value: 'A' }
const b = { handle: 'b', jsonSchema: {}, nullable: true, value: 'B' }
const c = { handle: 'c', jsonSchema: {}, nullable: false }
describe('port ordering', () => {
  it('moves in both directions without changing port identities or values', () => {
    const values = [a, b, c]
    const moved = movePort(values, 0, 2)
    expect(moved).toEqual([b, c, a])
    expect(moved[2]).toBe(a)
    expect(movePort(moved, 2, 0)).toEqual(values)
    expect(values).toEqual([a, b, c])
  })
  it('keeps group membership and headers intact', () => {
    const values = [{ group: 'First' }, a, b, { group: 'Second' }, c]
    expect(movePort(values, 1, 2)).toEqual([values[0], b, a, values[3], c])
    expect(movePort(values, 2, 4)).toBe(values)
    expect(movePort(values, 0, 3)).toBe(values)
  })
  it('ignores bounds and unchanged positions', () => {
    const values = [a, b]
    for (const [from, to] of [
      [0, -1],
      [1, 2],
      [-1, 1],
      [0, 0],
    ])
      expect(movePort(values, from!, to!)).toBe(values)
  })
})
