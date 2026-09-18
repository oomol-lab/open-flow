export function normalizeStorySearch(value: string): string {
  return value.toLowerCase().replaceAll(/\s/g, '')
}
