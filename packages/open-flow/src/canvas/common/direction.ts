/** Presentation direction; omitted legacy layouts run from left to right. */
export type CanvasDirection = 'horizontal' | 'vertical'

export function canvasDirection(value: unknown): CanvasDirection {
  return value === 'vertical' ? 'vertical' : 'horizontal'
}
