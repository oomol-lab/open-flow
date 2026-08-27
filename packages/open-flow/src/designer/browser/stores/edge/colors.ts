import type { HandleKind } from '../../components/handle.tsx'

export const edgeColors: Record<HandleKind, string> = {
  /** default */
  primitive: 'var(--edge-primitive)',
  bin: 'var(--edge-bin)',
  string: 'var(--edge-string)',
  error: 'var(--edge-error)',
}

export type EdgeColor = HandleKind

export type EdgeGradientColor = readonly [from: EdgeColor, to: EdgeColor]

export function gradientId(from: EdgeColor, to: EdgeColor): string {
  return `gradient-${from}-${to}`
}

export function gradientToStroke(from: EdgeColor, to: EdgeColor, inverse: boolean): string {
  return `url(#${inverse ? gradientId(to, from) : gradientId(from, to)})`
}

export function allPossibleEdgeGradients(): readonly EdgeGradientColor[] {
  const colors = Object.keys(edgeColors) as EdgeColor[]
  const gradients: EdgeGradientColor[] = []
  for (let i = 0; i < colors.length; i++) {
    for (let j = 0; j < colors.length; j++) {
      gradients.push([colors[i], colors[j]])
    }
  }
  return gradients
}
