import type { InteractiveMode } from '../../../../canvas/browser/stores/canvas/canvas.store.ts'
import type { WorkbenchPreferences } from '../contract.ts'

export const canvasInteractiveModePreferenceKey = 'open-flow:canvas-interactive-mode'

export function readCanvasInteractiveMode(preferences: WorkbenchPreferences): InteractiveMode {
  try {
    const mode = preferences.getItem(canvasInteractiveModePreferenceKey)
    return mode === 'mouse' || mode === 'touchpad' ? mode : 'touchpad'
  } catch {
    return 'touchpad'
  }
}

export function writeCanvasInteractiveMode(preferences: WorkbenchPreferences, mode: InteractiveMode): void {
  try {
    preferences.setItem(canvasInteractiveModePreferenceKey, mode)
  } catch {
    // Browser storage can be unavailable; the current session still uses the selected mode.
  }
}
