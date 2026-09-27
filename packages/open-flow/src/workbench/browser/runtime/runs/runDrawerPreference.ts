import type { WorkbenchPreferences } from '../contract.ts'

export const runDrawerPreferenceKey = 'open-flow:run-drawer-open'

export function readRunDrawerOpen(preferences: WorkbenchPreferences): boolean | undefined {
  try {
    const value = preferences.getItem(runDrawerPreferenceKey)
    return value == 'true' ? true : value == 'false' ? false : undefined
  } catch {
    return undefined
  }
}

export function writeRunDrawerOpen(preferences: WorkbenchPreferences, open: boolean): void {
  try {
    preferences.setItem(runDrawerPreferenceKey, String(open))
  } catch {
    // Keep the user's choice in memory when persistent storage is unavailable.
  }
}
