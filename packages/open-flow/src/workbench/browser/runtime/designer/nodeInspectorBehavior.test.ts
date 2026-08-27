import { describe, expect, it } from 'vitest'
import { taskDiagnosticReady, taskInspectorSection } from './nodeInspectorBehavior.ts'

describe('Task Inspector diagnostic navigation', () => {
  it.each(['node', 'task'] as const)('waits for the Settings panel before locating a %s diagnostic', (section) => {
    expect(taskInspectorSection(section)).toBe('settings')
    expect(taskDiagnosticReady(section, 'code')).toBe(false)
    expect(taskDiagnosticReady(section, 'settings')).toBe(true)
  })

  it('keeps Module diagnostics in the Code panel', () => {
    expect(taskInspectorSection('module')).toBe('code')
    expect(taskDiagnosticReady('module', 'settings')).toBe(false)
    expect(taskDiagnosticReady('module', 'code')).toBe(true)
  })
})
