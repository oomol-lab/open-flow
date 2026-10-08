import type { Scenario } from './scenarios.ts'
import type { Manifest } from './session.ts'

import { styleText } from 'node:util'

export function startupMessage(manifest: Manifest, scenario: Scenario, columns = 80): string {
  const width = Math.max(20, Math.min(columns - 4, 96))
  const lines: string[] = []
  let line = ''
  for (const word of scenario.task.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(`  ${line}`)
      line = ''
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(`  ${line}`)
  return [
    '',
    `  Open Flow CLI Lab / ${scenario.name}`,
    '',
    ...lines,
    '',
    `  Preview  ${styleText('cyan', manifest.preview ?? '', { stream: process.stdout })}`,
    `  Flow     ${manifest.flowId}`,
    `  Session  ${manifest.id}`,
    '',
    '  In another terminal:',
    '    bun run lab open       Open the workflow',
    '    bun run lab diff       Review changes',
    '    bun run lab verify     Verify the task',
    '    bun run lab report     Show operation costs',
    '    bun run lab reset      Start a new attempt',
    '',
    '  Ctrl+C to stop. Session data and reports are kept.',
    '',
  ].join('\n')
}
