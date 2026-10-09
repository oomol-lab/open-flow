import type { Scenario } from './scenarios.ts'
import type { Manifest } from './session.ts'

import { styleText } from 'node:util'

export function agentPrompt(manifest: Manifest, scenario: Scenario, workingDirectory: string): string {
  return [
    'Complete this workflow editing task:',
    '',
    scenario.task,
    '',
    `Working directory: ${workingDirectory}`,
    `Lab Session: ${manifest.id}`,
    `Flow: ${manifest.flowId}`,
    '',
    'Access the workflow only through this public CLI:',
    `bun run lab --session ${manifest.id} flow ...`,
    'Use its help, schema and public read interfaces to discover capabilities and workflow content.',
    'Offline help and local schema commands may run concurrently. Run deployment commands sequentially.',
    'You may create JSON request files. Do not modify repository code or read Lab fixtures, reference solutions, acceptance code, session files or databases.',
    'Do not run lab test, verify, next or reset. The operator will run independent acceptance after you finish.',
    'Complete the task and report your changes and checks.',
  ].join('\n')
}

export function startupMessage(manifest: Manifest, scenario: Scenario, workingDirectory: string, columns = 80): string {
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
    `    bun run lab --session ${manifest.id} open       Open the workflow`,
    `    bun run lab --session ${manifest.id} diff       Review changes`,
    `    bun run lab --session ${manifest.id} verify     Verify the task`,
    `    bun run lab --session ${manifest.id} report     Show operation costs`,
    ...(manifest.scenario == 'fulfillment-ops'
      ? [`    bun run lab --session ${manifest.id} next       After acceptance, get the next task for the same Agent and Flow`]
      : []),
    `    bun run lab --session ${manifest.id} reset      Start a new attempt`,
    '',
    '  Copy this prompt into a fresh Agent conversation:',
    '```text',
    agentPrompt(manifest, scenario, workingDirectory),
    '```',
    '',
    '  Ctrl+C to stop. Session data and reports are kept.',
    '',
  ].join('\n')
}
