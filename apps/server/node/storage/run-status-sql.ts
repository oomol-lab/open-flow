import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'

/**
 * Builds a parameterized membership predicate for a Run status scope.
 *
 * Run status sets are declared once in `run-lifecycle`; storage must not
 * repeat their literals. The column name is always an internal constant.
 */
export function statusIn(column: string, statuses: readonly RunStatus[]): { readonly params: readonly RunStatus[]; readonly sql: string } {
  if (statuses.length == 0) return { params: [], sql: '0' }
  return { params: statuses, sql: `${column} IN (${statuses.map(() => '?').join(', ')})` }
}
