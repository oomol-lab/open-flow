import type { WorkbenchPreferences } from '../contract.ts'

export const pngExportFramePreferenceKey = 'open-flow:png-export-frame'

export function readPngExportFrame(preferences?: WorkbenchPreferences): boolean {
  try {
    return preferences?.getItem(pngExportFramePreferenceKey) !== 'false'
  } catch {
    return true
  }
}

export function writePngExportFrame(preferences: WorkbenchPreferences | undefined, enabled: boolean): void {
  try {
    preferences?.setItem(pngExportFramePreferenceKey, String(enabled))
  } catch {
    // Keep the current choice usable when local storage is unavailable.
  }
}
