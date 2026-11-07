import type { LayoutPoint } from './wrapLayout.ts'

import { describe, expect, it } from 'vitest'
import { hasRouteCrossings } from './routeCrossings.ts'

function routes(...paths: readonly (readonly number[][])[]): ReadonlyMap<string, readonly LayoutPoint[]> {
  return new Map(paths.map((path, index) => [String(index), path.map(([x, y]) => ({ x: x!, y: y! }))]))
}

describe('route crossings', () => {
  it('accepts empty, single and separated routes', () => {
    expect(hasRouteCrossings(routes())).toBe(false)
    expect(
      hasRouteCrossings(
        routes([
          [0, 0],
          [20, 0],
        ]),
      ),
    ).toBe(false)
    expect(
      hasRouteCrossings(
        routes(
          [
            [0, 0],
            [20, 0],
          ],
          [
            [0, 10],
            [20, 10],
          ],
        ),
      ),
    ).toBe(false)
  })

  it('detects perpendicular crossings regardless of route and segment direction', () => {
    const paths = [
      [
        [0, 10],
        [20, 10],
      ],
      [
        [10, 0],
        [10, 20],
      ],
    ]
    for (const first of [paths[0]!, paths[0]!.toReversed()]) {
      for (const second of [paths[1]!, paths[1]!.toReversed()]) {
        expect(hasRouteCrossings(routes(first, second))).toBe(true)
        expect(hasRouteCrossings(routes(second, first))).toBe(true)
      }
    }
  })

  it.each([
    [
      [
        [0, 0],
        [20, 0],
      ],
      [
        [10, 0],
        [30, 0],
      ],
    ],
    [
      [
        [0, 0],
        [0, 20],
      ],
      [
        [0, 10],
        [0, 30],
      ],
    ],
    [
      [
        [0, 0],
        [20, 0],
      ],
      [
        [10, 0],
        [10, 20],
      ],
    ],
    [
      [
        [0, 0],
        [20, 0],
      ],
      [
        [20, 0],
        [20, 20],
      ],
    ],
  ])('detects unrelated collinear overlaps and endpoint contacts (%j)', (first, second) => {
    expect(hasRouteCrossings(routes(first!, second!))).toBe(true)
  })

  it.each([false, true])('allows a shared port and trunk with different waypoint splits (join=%s)', (join) => {
    const paths = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [10, 20],
        [30, 20],
      ],
      [
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
        [20, 10],
      ],
    ]
    expect(hasRouteCrossings(routes(...paths.map((path) => (join ? path.toReversed() : path))))).toBe(false)
    expect(
      hasRouteCrossings(
        routes(
          ...[
            [
              [0, 0],
              [20, 0],
            ],
            [
              [0, 0],
              [0, 20],
            ],
            [
              [0, 0],
              [-20, 0],
            ],
          ].map((path) => (join ? path.toReversed() : path)),
        ),
      ),
    ).toBe(false)
  })

  it('allows duplicate routes, zero-length segments and floating-point noise at shared ports', () => {
    expect(
      hasRouteCrossings(
        routes(
          [
            [0, 0],
            [0, 0],
            [20, 0],
          ],
          [
            [0, 0],
            [10, 0],
            [20, 0],
          ],
        ),
      ),
    ).toBe(false)
    expect(
      hasRouteCrossings(
        routes(
          [
            [0, 0],
            [20, 0],
            [20, 20],
          ],
          [
            [0, 0.00000001],
            [10, 0.00000001],
            [10, -20],
          ],
        ),
      ),
    ).toBe(false)
  })

  it.each([false, true])('still detects crossings beyond a shared trunk (join=%s)', (join) => {
    const paths = [
      [
        [0, 0],
        [10, 0],
        [10, 20],
        [30, 20],
      ],
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [20, 10],
        [20, 30],
      ],
    ]
    expect(hasRouteCrossings(routes(...paths.map((path) => (join ? path.toReversed() : path))))).toBe(true)
  })
})
