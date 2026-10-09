import type { CommandRecord } from '@oomol-lab/open-flow-command/lab'

import { isDeepStrictEqual } from 'node:util'

export interface AdmissionFailure {
  id: string
  args: string[]
  reason: string
  at: string
  argumentBytes: number
  outputBytes: number
}

export interface Attempt {
  id: string
  scenario: string
  scenarioVersion: number
  scenarioIdentity?: string
  stage?: number
  stageName?: string
  previousAttemptId?: string
  excludedWallMs?: number
  startedAt: string
  endedAt?: string
  startRevision: string
  endRevision?: string
  passed?: boolean
  mixed: boolean
  script?: string
  git: { head: string; dirty: boolean; diffDigest: string }
  excluded?: { kind: string; durationMs: number; revision?: string; runId?: string; sample?: string }[]
  rejectedEdits?: number
  transport?: 'cli' | 'mcp'
  commands: CommandRecord[]
  after: CommandRecord[]
  admissionFailures?: AdmissionFailure[]
  afterAdmissionFailures?: AdmissionFailure[]
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
    httpMs: 0,
    httpInputBytes: 0,
    httpOutputBytes: 0,
    commandMs: 0,
  }
  const categories: Record<string, number> = {}
  const admissionFailures = attempt.admissionFailures ?? []
  const admissionArgumentBytes = admissionFailures.reduce((sum, failure) => sum + failure.argumentBytes, 0)
  const admissionOutputBytes = admissionFailures.reduce((sum, failure) => sum + failure.outputBytes, 0)
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
      totals.httpMs += request.durationMs ?? 0
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
    toolCalls: totals.operations + admissionFailures.length,
    admissionRejections: admissionFailures.length,
    admissionArgumentBytes,
    admissionOutputBytes,
    retries,
    categories,
    // A repair attempt is an edit submitted after a rejected edit, regardless of request identity.
    repairAttempts: attempt.commands.filter(
      (c, i) => c.category == 'edit' && attempt.commands.slice(0, i).some((previous) => previous.category == 'edit' && previous.exitCode != 0),
    ).length,
    revisionConflicts: attempt.rejectedEdits ?? 0,
    excluded: attempt.excluded ?? [],
    visibleInputBytes: totals.argumentBytes + totals.inputContentBytes + admissionArgumentBytes,
    visibleOutputBytes: totals.stdoutBytes + totals.stderrBytes + admissionOutputBytes,
    wallMs: Math.max(
      0,
      Date.parse(attempt.endedAt ?? new Date().toISOString()) -
        Date.parse(attempt.startedAt) -
        (attempt.excludedWallMs ?? 0) -
        (attempt.excluded ?? []).filter((e) => e.kind == 'operator-edit').reduce((sum, e) => sum + e.durationMs, 0),
    ),
  }
}
export function compare(current: Attempt, other: Attempt) {
  if (!current.passed || !other.passed || current.mixed || other.mixed) throw new Error('Compare requires two successful, controlled attempts.')
  if (current.scenario != other.scenario || current.scenarioVersion != other.scenarioVersion) throw new Error('Compare requires the same scenario and version.')
  if (current.stage != other.stage) throw new Error('Compare requires the same stage.')
  if (current.scenarioIdentity != other.scenarioIdentity) throw new Error('Compare requires the same fixture and verifier.')
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
    ...(a.stage == null ? [] : [`Stage ${a.stage + 1}: ${a.stageName}; previous attempt: ${a.previousAttemptId ?? 'none'}`]),
    `Revision: ${a.startRevision} → ${a.endRevision ?? '(active)'}`,
    `${a.transport ?? 'cli'}: ${totals.operations} operations, ${totals.failures} nonzero exits, ${totals.retries} exact request replays`,
    `Tool calls: ${totals.toolCalls}; Lab admission rejections: ${totals.admissionRejections} (no production HTTP request or edit submission)`,
    ...(a.admissionFailures ?? []).map((failure) => `Admission rejected ${failure.args.join(' ')}: ${failure.reason}`),
    `Visible input: ${totals.visibleInputBytes} B (arguments ${totals.argumentBytes}, content ${totals.inputContentBytes}, rejected arguments ${totals.admissionArgumentBytes})`,
    `Visible output: ${totals.visibleOutputBytes} B (stdout ${totals.stdoutBytes}, stderr ${totals.stderrBytes}, admission errors ${totals.admissionOutputBytes})`,
    `HTTP: ${totals.httpRequests} requests, ${totals.httpInputBytes} B sent, ${totals.httpOutputBytes} B received; ${totals.httpMs.toFixed(1)} ms`,
    `Time: commands ${totals.commandMs.toFixed(1)} ms; task wall ${totals.wallMs} ms`,
    ...a.commands.map(
      (c, index) =>
        `${index + 1}. [${c.category}, exit ${c.exitCode}] ${c.args.join(' ')}\n   arguments ${c.argumentBytes} B; inputs ${c.inputs.map((i) => `${i.source} ${i.bytes} B`).join(', ') || 'none'}; stdout ${c.stdoutBytes} B; stderr ${c.stderrBytes} B\n${c.requests.map((r) => `   ${r.method} ${r.path}: ${r.status ?? 'transport error'}, ${r.inputBytes} B → ${r.outputBytes} B`).join('\n')}`,
    ),
    ...a.verifications.flatMap((v) => v.errors.map((error) => `Verification ${v.revisionId}: ${error}`)),
    `${a.after.length} post-completion commands and ${a.afterAdmissionFailures?.length ?? 0} admission rejections excluded. Byte counts are not model tokens or minimum solution costs.`,
    ...(a.git.dirty ? ['Source had local modifications. Git HEAD plus the recorded digest cannot reconstruct untracked file contents.'] : []),
    ...(report.comparison == null ? [] : [JSON.stringify(report.comparison, null, 2)]),
  ].join('\n')
}
