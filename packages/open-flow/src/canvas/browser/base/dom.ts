import { toPlainObject } from './trivial.ts'

const nav = typeof navigator !== 'undefined' ? navigator : { platform: '' }

export const isMac: boolean = /*#__PURE__*/ /Mac/.test(nav.platform)

export interface EventLike {
  preventDefault(): void
  stopPropagation(): void
}

export function stopPropagation(event: EventLike): void {
  event.stopPropagation()
}

export function stopEvent(event: EventLike, cancelBubble?: boolean): void {
  event.preventDefault()
  if (cancelBubble) event.stopPropagation()
}

interface EventLikeConstructor {
  new (type: string, options: any): Event
}

export function dispatchEvent(target: EventTarget, Ctor: EventLikeConstructor, type: string, init?: unknown): void {
  const event = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    ...toPlainObject(init),
  })
  Object.defineProperty(event, 'target', { get: () => target })
  target.dispatchEvent(event)
}

/**
 * @example
 * ```js
 * onClick(ev => isInside(ev.target, '.class1, .class2'))
 * ```
 */
export function isInside(target: EventTarget | null, selector: string): boolean {
  return (target as Partial<HTMLElement> | null)?.closest?.(selector) != null
}
