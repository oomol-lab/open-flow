import type { CommandRecord } from '@oomol-lab/open-flow-command/lab'

import { isDeepStrictEqual } from 'node:util'

export interface Attempt {
  id: string
  scenario: string
  scenarioVersion: number
  startedAt: string
  endedAt?: string
  startRevision: string
  endRevision?: string
  passed?: boolean
  mixed: boolean
  script?: string
  git: { head: string; dirty: boolean; diffDigest: string }
  commands: CommandRecord[]
  after: CommandRecord[]
  verifications: { revisionId: string; passed: boolean; errors: string[]; runId?: string }[]
}
export function summary(attempt: Attempt) {
  const keys = new Set<string>()
  let retries = 0
  const totals = {
    operations: attempt.commands.length,
    failures: 0,
    argumentBytes: 0,
    inputContentBytes: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    httpRequests: 0,
    httpInputBytes: 0,
    httpOutputBytes: 0,
    commandMs: 0,
  }
  const categories: Record<string, number> = {}
  for (const command of attempt.commands) {
    categories[command.category] = (categories[command.category] ?? 0) + 1
    totals.failures += Number(command.exitCode != 0)
    totals.argumentBytes += command.argumentBytes
    totals.inputContentBytes += command.inputs.reduce((sum, input) => sum + input.bytes, 0)
    totals.stdoutBytes += command.stdoutBytes
    totals.stderrBytes += command.stderrBytes
    totals.commandMs += command.durationMs
    for (const request of command.requests) {
      totals.httpRequests++
      totals.httpInputBytes += request.inputBytes
      totals.httpOutputBytes += request.outputBytes
      if (request.retryIdentity != null) {
        if (keys.has(request.retryIdentity)) retries++
        keys.add(request.retryIdentity)
      }
    }
  }
  return {
    ...totals,
    retries,
    categories,
    visibleInputBytes: totals.argumentBytes + totals.inputContentBytes,
    visibleOutputBytes: totals.stdoutBytes + totals.stderrBytes,
    wallMs: Date.parse(attempt.endedAt ?? new Date().toISOString()) - Date.parse(attempt.startedAt),
  }
}
export function compare(current: Attempt, other: Attempt) {
  if (!current.passed || !other.passed || current.mixed || other.mixed) throw new Error('Compare requires two successful, CLI-only attempts.')
  if (current.scenario != other.scenario || current.scenarioVersion != other.scenarioVersion) throw new Error('Compare requires the same scenario and version.')
  const a = summary(current),
    b = summary(other)
  return {
    against: other.id,
    delta: Object.fromEntries(
      Object.entries(a).flatMap(([key, value]) => (typeof value == 'number' ? [[key, value - (b[key as keyof typeof b] as number)]] : [])),
    ),
    limitations: [
      'Costs describe these recorded solutions, not minimum operations or model usage.',
      ...(current.git.dirty || other.git.dirty ? ['Local modifications were present; Git identity alone does not reproduce the source.'] : []),
    ],
  }
}
export function diff(before: unknown, after: unknown, path = ''): { path: string; before?: unknown; after?: unknown }[] {
  if (isDeepStrictEqual(before, after)) return []
  if (before != null && after != null && typeof before == 'object' && typeof after == 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      diff(a[key], b[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    )
  }
  return [{ path, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }]
}

export function reportText(report: { attempt: Attempt; comparison?: unknown }): string {
  const a = report.attempt,
    totals = summary(a)
  return [
    `${a.scenario} / ${a.id}: ${a.passed == null ? 'in progress' : a.passed ? 'passed' : 'failed or stopped'}${a.mixed ? ' (includes other-client edits)' : ''}`,
    `Revision: ${a.startRevision} → ${a.endRevision ?? '(active)'}`,
    `CLI: ${totals.operations} operations, ${totals.failures} nonzero exits, ${totals.retries} exact request replays`,
    `Visible input: ${totals.visibleInputBytes} B (arguments ${totals.argumentBytes}, content ${totals.inputContentBytes})`,
    `Visible output: ${totals.visibleOutputBytes} B (stdout ${totals.stdoutBytes}, stderr ${totals.stderrBytes})`,
    `HTTP: ${totals.httpRequests} requests, ${totals.httpInputBytes} B sent, ${totals.httpOutputBytes} B received`,
    `Time: commands ${totals.commandMs.toFixed(1)} ms; task wall ${totals.wallMs} ms`,
    ...a.commands.map(
      (c, index) =>
        `${index + 1}. [${c.category}, exit ${c.exitCode}] ${c.args.join(' ')}\n   arguments ${c.argumentBytes} B; inputs ${c.inputs.map((i) => `${i.source} ${i.bytes} B`).join(', ') || 'none'}; stdout ${c.stdoutBytes} B; stderr ${c.stderrBytes} B\n${c.requests.map((r) => `   ${r.method} ${r.path}: ${r.status ?? 'transport error'}, ${r.inputBytes} B → ${r.outputBytes} B`).join('\n')}`,
    ),
    ...a.verifications.flatMap((v) => v.errors.map((error) => `Verification ${v.revisionId}: ${error}`)),
    `${a.after.length} post-completion commands excluded. Byte counts are not model tokens or minimum solution costs.`,
    ...(a.git.dirty ? ['Source had local modifications. Git HEAD plus the recorded digest cannot reconstruct untracked file contents.'] : []),
    ...(report.comparison == null ? [] : [JSON.stringify(report.comparison, null, 2)]),
  ].join('\n')
}
