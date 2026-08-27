import type { DiagnosticFocus } from './diagnostics.ts'

export function taskInspectorSection(section: DiagnosticFocus['section'] | undefined): 'code' | 'settings' {
  return section == 'node' || section == 'task' ? 'settings' : 'code'
}

export function taskDiagnosticReady(section: DiagnosticFocus['section'], current: 'code' | 'settings'): boolean {
  if (section == 'node' || section == 'task') return current == 'settings'
  if (section == 'module') return current == 'code'
  return true
}
