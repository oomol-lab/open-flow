import { expect, it, vi } from 'vitest'
import { pngExportFramePreferenceKey, readPngExportFrame, writePngExportFrame } from './pngExportPreference.ts'

it('enables the frame by default and restores a locally saved choice', () => {
  const saved = new Map<string, string>()
  const preferences = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  expect(readPngExportFrame(preferences)).toBe(true)
  writePngExportFrame(preferences, false)
  expect(saved.get(pngExportFramePreferenceKey)).toBe('false')
  expect(readPngExportFrame(preferences)).toBe(false)
  writePngExportFrame(preferences, true)
  expect(readPngExportFrame(preferences)).toBe(true)
})

it('keeps exporting usable when local persistence is unavailable', () => {
  const denied = vi.fn(() => {
    throw new Error('Storage unavailable')
  })
  const preferences = { getItem: denied, setItem: denied }
  expect(readPngExportFrame()).toBe(true)
  expect(readPngExportFrame(preferences)).toBe(true)
  expect(() => writePngExportFrame(preferences, false)).not.toThrow()
})
