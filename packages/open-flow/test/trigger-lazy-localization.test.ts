import { expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({ chinese: 0, french: 0 }))
vi.mock('../src/trigger/providers/locales/zh-CN.ts', () => {
  loaded.chinese++
  return { default: { sample: { displayName: '示例' } } }
})
vi.mock('../src/trigger/providers/locales/fr.ts', () => {
  loaded.french++
  return { default: { sample: { displayName: 'Exemple' } } }
})

it('loads only the requested language and shares its result between concurrent calls', async () => {
  const { loadTriggerTranslations } = await import('../src/trigger/providers/localization.ts')
  expect(loaded).toEqual({ chinese: 0, french: 0 })
  expect(await loadTriggerTranslations('en')).toEqual({})
  expect(loaded).toEqual({ chinese: 0, french: 0 })
  const chinese = loadTriggerTranslations('zh-CN')
  expect(loadTriggerTranslations('zh-CN')).toBe(chinese)
  expect(await chinese).toEqual({ sample: { displayName: '示例' } })
  expect(loaded).toEqual({ chinese: 1, french: 0 })
  expect(await loadTriggerTranslations('fr')).toEqual({ sample: { displayName: 'Exemple' } })
  expect(loaded).toEqual({ chinese: 1, french: 1 })
})
