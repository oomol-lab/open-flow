import type { CanvasDirection } from '../../../../canvas/common/direction.ts'
import type { WorkbenchPreferences } from '../contract.ts'

export const canvasDirectionPreferenceKey = 'open-flow:canvas-direction'

export function readCanvasDirection(preferences: WorkbenchPreferences): CanvasDirection {
  try {
    return preferences.getItem(canvasDirectionPreferenceKey) === 'horizontal' ? 'horizontal' : 'vertical'
  } catch {
    return 'vertical'
  }
}

export function writeCanvasDirection(preferences: WorkbenchPreferences, direction: CanvasDirection): void {
  try {
    preferences.setItem(canvasDirectionPreferenceKey, direction)
  } catch {
    // Keep the selected default in the current session when browser storage is unavailable.
  }
}
