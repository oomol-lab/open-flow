import { expect, it, vi } from 'vitest'
import {
  pngExportFramePreferenceKey,
  readPngExportFrame,
  writePngExportFrame,
  pngExportLayoutPreferenceKey,
  readPngExportLayout,
  writePngExportLayout,
  readPngExportAspectRatio,
  writePngExportAspectRatio,
  readPngExportDark,
  writePngExportDark,
} from './pngExportPreference.ts'

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

it('defaults to the original layout and restores the compact export choice', () => {
  const saved = new Map<string, string>()
  const preferences = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  expect(readPngExportLayout()).toBe('original')
  expect(readPngExportLayout(preferences)).toBe('original')
  writePngExportLayout(preferences, 'compact')
  expect(saved.get(pngExportLayoutPreferenceKey)).toBe('compact')
  expect(readPngExportLayout(preferences)).toBe('compact')
  writePngExportLayout(preferences, 'original')
  expect(readPngExportLayout(preferences)).toBe('original')
  const denied = {
    getItem() {
      throw new Error('Unavailable')
    },
    setItem() {
      throw new Error('Unavailable')
    },
  }
  expect(readPngExportLayout(denied)).toBe('original')
  expect(() => writePngExportLayout(denied, 'compact')).not.toThrow()
})

it('remembers canvas ratio and theme and ignores invalid stored values', () => {
  const saved = new Map<string, string>()
  const preferences = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  expect(readPngExportAspectRatio(preferences)).toBe('auto')
  expect(readPngExportDark(preferences, true)).toBe(true)
  writePngExportAspectRatio(preferences, '16:9')
  writePngExportDark(preferences, false)
  expect(readPngExportAspectRatio(preferences)).toBe('16:9')
  expect(readPngExportDark(preferences, true)).toBe(false)
  const denied = {
    getItem() {
      throw new Error('Unavailable')
    },
    setItem() {
      throw new Error('Unavailable')
    },
  }
  expect(readPngExportAspectRatio(denied)).toBe('auto')
  expect(readPngExportDark(denied, true)).toBe(true)
  expect(readPngExportAspectRatio({ getItem: () => '17:2', setItem: () => {} })).toBe('auto')
  expect(() => writePngExportAspectRatio(denied, '9:16')).not.toThrow()
  expect(() => writePngExportDark(denied, true)).not.toThrow()
})
