import type { Revision } from '../../src/base/common/revision.ts'
import type { PackageMeta } from '../../src/manifest/common/meta/package/packageMeta.ts'
import type { UserLocalesContext } from '../../src/manifest/common/meta/package/userLocales.ts'
import type { ManifestReadResult, ManifestSource } from '../../src/manifest/common/source.ts'

import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { UserLocales } from '../../src/manifest/common/meta/package/userLocales.ts'

const packageDir = '/workspace/localization-fixture'

class TestUserLocalesContext implements UserLocalesContext {
  public readonly lang$ = val('en')
  public async readFile(path: string): Promise<ManifestSource | undefined>
  public async readFile(path: string, refRevision: Revision | undefined): Promise<ManifestReadResult>
  public async readFile(_path: string, _refRevision?: Revision): Promise<ManifestReadResult> {
    return undefined
  }
}

function createUserLocales(): { context: TestUserLocalesContext; locales: UserLocales } {
  const context = new TestUserLocalesContext()
  const packageMeta = { packageDir } as PackageMeta
  return { context, locales: new UserLocales(packageMeta, context) }
}

describe('package localization', () => {
  it('localizes placeholder display values and keeps detail searchable in English', () => {
    const { context, locales } = createUserLocales()
    const title$ = val<string | undefined>('%package-title%')
    const description$ = val<string | undefined>('%package-description%')
    const displayTitle$ = locales.display$(title$)
    const displayDescription$ = locales.display$(description$)
    const detail$ = locales.detail$(title$, description$)
    try {
      locales.updateSource('en', {
        source: JSON.stringify({
          'package-title': 'English title',
          'package-description': 'English description',
        }),
        revision: 'en-revision-1' as Revision,
      })
      locales.updateSource('zh-CN', {
        source: JSON.stringify({
          'package-title': 'Chinese title',
          'package-description': 'Chinese description',
        }),
        revision: 'zh-revision-1' as Revision,
      })

      expect(displayTitle$.value).toBe('English title')
      expect(displayDescription$.value).toBe('English description')
      expect(detail$.value).toBe('English title English description')
      expect(locales.display('Literal title')).toBe('Literal title')

      context.lang$.set('zh-CN')

      expect(displayTitle$.value).toBe('Chinese title')
      expect(displayDescription$.value).toBe('Chinese description')
      expect(detail$.value).toBe('English title English description')
    } finally {
      detail$.dispose()
      displayDescription$.dispose()
      displayTitle$.dispose()
      description$.dispose()
      title$.dispose()
      locales.dispose()
    }
  })

  it('reads Simplified Chinese before English for a Traditional Chinese UI', () => {
    const { context, locales } = createUserLocales()
    try {
      locales.updateSource('en', {
        source: JSON.stringify({ 'package-title': 'English title' }),
        revision: 'en-revision-1' as Revision,
      })
      locales.updateSource('zh-CN', {
        source: JSON.stringify({ 'package-title': 'Chinese title' }),
        revision: 'zh-revision-1' as Revision,
      })

      context.lang$.set('zh-TW')

      expect(locales.localize('package-title')).toBe('Chinese title')
      expect(locales.localize('package-missing', 'fallback')).toBe('fallback')
    } finally {
      locales.dispose()
    }
  })

  it('reads English first for languages without an authored locale file', () => {
    const { context, locales } = createUserLocales()
    try {
      locales.updateSource('en', {
        source: JSON.stringify({ 'package-title': 'English title' }),
        revision: 'en-revision-1' as Revision,
      })
      locales.updateSource('zh-CN', {
        source: JSON.stringify({ 'package-title': 'Chinese title', 'package-note': 'Chinese note' }),
        revision: 'zh-revision-1' as Revision,
      })

      context.lang$.set('ja')

      expect(locales.localize('package-title')).toBe('English title')
      // English carries no such key, so the chain continues into Simplified Chinese.
      expect(locales.localize('package-note')).toBe('Chinese note')
    } finally {
      locales.dispose()
    }
  })

  it('advances revisions only for valid source updates and stops after disposal', () => {
    const { locales } = createUserLocales()
    const english = locales.locales.en
    const firstRevision = 'en-revision-1' as Revision
    const secondRevision = 'en-revision-2' as Revision
    const invalidRevision = 'en-revision-invalid' as Revision

    english.updateSource({ source: '{"title":"First"}', revision: firstRevision })
    expect(english.baselineRevision).toBe(firstRevision)
    expect(english.localize('title')).toBe('First')
    expect(english._toSaveFileString()).toBe('{\n  "title": "First"\n}\n')

    english.updateSource({ source: '{"title":"Ignored"}', revision: firstRevision })
    expect(english.localize('title')).toBe('First')

    english.updateSource({ source: '{"title":"Second"}', revision: secondRevision })
    expect(english.baselineRevision).toBe(secondRevision)
    expect(english.localize('title')).toBe('Second')

    english.updateSource({ source: '{', revision: invalidRevision })
    expect(english.baselineRevision).toBe(secondRevision)
    expect(english.localize('title')).toBe('Second')

    english.updateSource({ source: '{"title":"Recovered"}', revision: invalidRevision })
    expect(english.baselineRevision).toBe(invalidRevision)
    expect(english.localize('title')).toBe('Recovered')

    locales.dispose()
    english.updateSource({ source: '{"title":"After dispose"}', revision: 'en-revision-3' as Revision })

    expect(english.baselineRevision).toBe(invalidRevision)
    expect(english.localize('title')).toBe('Recovered')
  })
})
