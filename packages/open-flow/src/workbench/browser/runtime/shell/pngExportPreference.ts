import type { FlowPngAspectRatio, FlowPngLayout } from '../../../../render/common/png.ts'
import type { WorkbenchPreferences } from '../contract.ts'

import { flowPngAspectRatios } from '../../../../render/common/png.ts'

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

export const pngExportLayoutPreferenceKey = 'open-flow:png-export-layout'

export function readPngExportLayout(preferences?: WorkbenchPreferences): FlowPngLayout {
  try {
    return preferences?.getItem(pngExportLayoutPreferenceKey) === 'compact' ? 'compact' : 'original'
  } catch {
    return 'original'
  }
}

export function writePngExportLayout(preferences: WorkbenchPreferences | undefined, layout: FlowPngLayout): void {
  try {
    preferences?.setItem(pngExportLayoutPreferenceKey, layout)
  } catch {
    // Keep the current choice usable when local storage is unavailable.
  }
}

export const pngExportAspectRatioPreferenceKey = 'open-flow:png-export-aspect-ratio'
export const pngExportThemePreferenceKey = 'open-flow:png-export-theme'

export function readPngExportAspectRatio(preferences?: WorkbenchPreferences): FlowPngAspectRatio {
  try {
    const value = preferences?.getItem(pngExportAspectRatioPreferenceKey)
    return flowPngAspectRatios.find((ratio) => ratio === value) ?? 'auto'
  } catch {
    return 'auto'
  }
}

export function writePngExportAspectRatio(preferences: WorkbenchPreferences | undefined, value: FlowPngAspectRatio): void {
  try {
    preferences?.setItem(pngExportAspectRatioPreferenceKey, value)
  } catch {
    // Keep the choice usable when local storage is unavailable.
  }
}

export function readPngExportDark(preferences: WorkbenchPreferences | undefined, defaultDark: boolean): boolean {
  try {
    const value = preferences?.getItem(pngExportThemePreferenceKey)
    return value === 'dark' ? true : value === 'light' ? false : defaultDark
  } catch {
    return defaultDark
  }
}

export function writePngExportDark(preferences: WorkbenchPreferences | undefined, dark: boolean): void {
  try {
    preferences?.setItem(pngExportThemePreferenceKey, dark ? 'dark' : 'light')
  } catch {
    // Keep the choice usable when local storage is unavailable.
  }
}
