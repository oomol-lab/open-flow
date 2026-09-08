export const maxJsonDepth = 64

export function checkJsonDepth(value: unknown, depth = 0): void {
  if (depth > maxJsonDepth) throw new TypeError('Value exceeds the maximum JSON depth.')
  if (value != null && typeof value == 'object') {
    for (const child of Object.values(value)) checkJsonDepth(child, depth + 1)
  }
}
