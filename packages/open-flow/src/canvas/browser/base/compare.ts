import type { XYPosition, Dimensions as Size, Viewport } from '@xyflow/react'

import { isPlainObject } from '@wopjs/cast'
import { isNumber } from 'radash'

export { XYPosition, Size, Viewport }

export const isXYPosition = (p: unknown): p is XYPosition => isPlainObject(p) && isNumber(p.x) && isNumber(p.y)

export const isSameXYPosition = (p1?: XYPosition, p2?: XYPosition): boolean => (!p1 || !p2 ? p1 === p2 : p1.x === p2.x && p1.y === p2.y)

export const toXYPosition = (p: unknown): XYPosition | undefined => (isXYPosition(p) ? p : undefined)

export const isSize = (s: unknown): s is Size => isPlainObject(s) && isNumber(s.width) && isNumber(s.height)

export const isSameSize = (s1?: Partial<Size>, s2?: Partial<Size>): boolean => (!s1 || !s2 ? s1 === s2 : s1.width === s2.width && s1.height === s2.height)

export const toSize = (s: unknown): Size | undefined => (isSize(s) ? s : undefined)

export const isViewport = (v: unknown): v is Viewport => isPlainObject(v) && isNumber(v.zoom) && isXYPosition(v)

export const isSameViewport = (v1?: Viewport, v2?: Viewport): boolean => (!v1 || !v2 ? v1 === v2 : v1.x === v2.x && v1.y === v2.y && v1.zoom === v2.zoom)

export const optionalCompare =
  <T>(compare: (v1: T, v2: T) => boolean): ((v1: T | null | undefined, v2: T | null | undefined) => boolean) =>
  (v1, v2) =>
    Object.is(v1, v2) || (v1 != null && v2 != null && compare(v1, v2))
