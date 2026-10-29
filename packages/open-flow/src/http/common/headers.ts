/** Header names are case-insensitive; never silently combine duplicate business fields. */
export function httpHeaderNameIssue(name: string, names: readonly string[]): 'invalid' | 'duplicate' | undefined {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return 'invalid'
  if (names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) return 'duplicate'
}
