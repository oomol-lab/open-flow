import type { DisposableStore, IDisposable } from '@wopjs/disposable'
import type { AddEventListener } from '@wopjs/event'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { Revision } from '../../../../base/common/revision.ts'
import type { LocaleTextMap, LocaleTextStore, TranslateText } from '../../../../localization/common/localization.ts'
import type { GroupDividerDef, HandleName } from '../../../../schema/index.ts'
import type { ManifestReadResult, ManifestSource } from '../../source.ts'
import type { PackageMeta } from './packageMeta.ts'

import { inertFilterMap, isString, toPlainObjectOf } from '@wopjs/cast'
import { disposableStore } from '@wopjs/disposable'
import { event, send } from '@wopjs/event'
import { mapValues } from 'radash'
import { compute, isVal, val } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { join } from '../../../../base/common/posixPath.ts'
import { localeChain } from '../../../../localization/common/localization.ts'
import { isGroupDividerDef } from '../../model/block/base/blockManifest.ts'
import { unchangedManifestSource } from '../../source.ts'

export type UserLanguage = 'en' | 'zh-CN'

export function isUserTranslateKey(str: string | undefined): str is `%${string}%` {
  return typeof str === 'string' && str.startsWith('%') && str.endsWith('%') && str.length > 2
}

/** `"%key%"` → `"key"`, otherwise `undefined` */
export function toUserTranslateKey(str: string | undefined): string | undefined {
  return isUserTranslateKey(str) ? str.slice(1, -1) : undefined
}

function extractLangFromPath(str: string | undefined): UserLanguage | undefined {
  if (typeof str !== 'string') return undefined
  if (str.endsWith('en.json')) return 'en'
  if (str.endsWith('zh-CN.json')) return 'zh-CN'
}

function isEnglish(str: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(str)
}

function isBannedName(name: string): boolean {
  return name === '__proto__'
}

const MaxKeyLength = 64

export interface UserLocalesContext {
  readonly lang$: ReadonlyVal<string>
  readFile(path: string): Promise<ManifestSource | undefined>
  readFile(path: string, refRevision: Revision | undefined): Promise<ManifestReadResult>
}

export class UserLocales {
  public readonly dispose: DisposableStore = disposableStore()
  public readonly onDidChange: AddEventListener<Translation>

  public readonly locales: {
    readonly [Lang in UserLanguage]: Translation
  }

  public readonly designerLocales: LocaleTextStore

  public constructor(
    private readonly packageMeta: PackageMeta,
    private readonly ctx: UserLocalesContext,
  ) {
    this.locales = {
      'en': this.dispose.add(new Translation(this.getTranslationPath('en'), this.ctx)),
      'zh-CN': this.dispose.add(new Translation(this.getTranslationPath('zh-CN'), this.ctx)),
    }
    this.designerLocales = mapValues(this.locales, (locale) => locale.data$)

    this.onDidChange = this.dispose.add(event())
    for (const locale of Object.values(this.locales)) {
      this.dispose.add(locale.onDidChange(send.bind(null, this.onDidChange)))
    }
  }

  public getTranslationPath(lang: UserLanguage): string
  public getTranslationPath(pattern: string): string
  public getTranslationPath(name: string): string {
    return join(this.packageMeta.packageDir, 'oo-locales', `${name}.json`)
  }

  /** Generates and writes a unique translation key for a non-empty value. */
  public generateTranslateKey(value: string | undefined, hint?: string): string | undefined {
    if (!value || value.trim() === '') return
    const detectLang: UserLanguage = isEnglish(value) ? 'en' : 'zh-CN'
    const locale = this.locales[detectLang]
    if (!hint) {
      hint = value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '-')
        .replace(/^-+/, '')
        .slice(0, MaxKeyLength)
        .replace(/-+$/, '')
      if (!hint || isBannedName(hint)) {
        hint = 'key'
      }
    }
    let uniqueKey = hint
    let i = 1
    while (locale.has(uniqueKey)) {
      uniqueKey = `${hint}${++i}`
    }
    locale.set(uniqueKey, value)
    return uniqueKey
  }

  public async fillTranslation(key: string, translate: TranslateText, signal?: AbortSignal): Promise<void> {
    const english = this.locales['en'].localize(key)
    const chinese = this.locales['zh-CN'].localize(key)

    if (english && chinese) return
    if (!english && !chinese) return

    if (chinese) {
      const result = await translate(chinese, 'zh-CN', 'en')
      if (signal?.aborted) return
      if (result.isOk()) {
        this.locales['en'].set(key, result.unwrap())
      }
    } else if (english) {
      const result = await translate(english, 'en', 'zh-CN')
      if (signal?.aborted) return
      if (result.isOk()) {
        this.locales['zh-CN'].set(key, result.unwrap())
      }
    }
  }

  public async refreshLocales(translationPath?: string): Promise<void> {
    if (translationPath) {
      const lang = extractLangFromPath(translationPath)
      const locale = lang ? this.locales[lang] : undefined
      if (locale) await locale.refresh()
    } else {
      await Promise.all(Object.values(this.locales).map((locale) => locale.refresh()))
    }
  }

  public updateSource(lang: string, snapshot: ManifestSource): void {
    const locale = this.locales[lang as UserLanguage] as Translation | undefined
    if (!locale) return
    locale.updateSource(snapshot)
  }

  // The manifest domain implements localization without depending on Designer.
  public localize$(get: ComputeGet, key: string, defaultValue?: string): string {
    for (const locale of localeChain(this.locales, get(this.ctx.lang$))) {
      const value = locale.localize$(get, key)
      if (value) return value
    }

    return defaultValue || key
  }

  public localize(key: string, defaultValue?: string): string {
    return this.localize$(get, key, defaultValue)
  }

  public display(str: string | undefined, defaultValue: string): string
  public display(str: string | undefined, defaultValue?: string): string | undefined
  public display(str: string | undefined, defaultValue?: string): string | undefined {
    const key = toUserTranslateKey(str)
    return key ? this.localize(key, str || defaultValue) : str || defaultValue
  }

  public display$($: ReadonlyVal<string | undefined>, defaultValue: string): ReadonlyVal<string>
  public display$($: ReadonlyVal<string | undefined>, defaultValue?: string): ReadonlyVal<string | undefined>
  public display$($: ReadonlyVal<string | undefined>, defaultValue?: string): ReadonlyVal<string | undefined> {
    return compute((get) => {
      const str = get($)
      const key = toUserTranslateKey(str)
      return key ? this.localize$(get, key, str || defaultValue) : str || defaultValue
    })
  }

  /** Combines the English title and description for quick-pick search. */
  public detail$(title$: ReadonlyVal<string | undefined>, description$: ReadonlyVal<string | undefined>): ReadonlyVal<string | undefined> {
    return compute((get) => {
      const english = this.locales['en']

      const titleStr = get(title$)
      const titleKey = toUserTranslateKey(titleStr)
      const title = titleKey ? english.localize$(get, titleKey) || titleStr : titleStr

      const descriptionStr = get(description$)
      const descriptionKey = toUserTranslateKey(descriptionStr)
      const description = descriptionKey ? english.localize$(get, descriptionKey) || descriptionStr : descriptionStr

      if (title && description) {
        return `${title} ${description}`
      }
      return title || description
    })
  }

  /** Localizes one handle definition, including a Condition default case. */
  public readonly displayHandleDef$ = <D extends { handle: HandleName; description?: string } | GroupDividerDef>(
    def$: ReadonlyVal<D | undefined>,
  ): ReadonlyVal<D | undefined> =>
    compute((get) => {
      const def = get(def$)
      if (!def) return def
      if (isGroupDividerDef(def)) {
        return def
      } else {
        const str = def.description
        const key = toUserTranslateKey(str)
        return key ? { ...def, description: this.localize$(get, key, str) } : def
      }
    })

  /** Localizes input and output handle descriptions for authoring surfaces. */
  public readonly displayHandleDefs$ = <D extends { handle: HandleName; description?: string } | GroupDividerDef>(
    defs$: ReadonlyVal<D[] | undefined>,
  ): ReadonlyVal<D[] | undefined> =>
    compute((get) =>
      inertFilterMap(get(defs$), (def) => {
        if (isGroupDividerDef(def)) {
          return def
        } else {
          const str = def.description
          const key = toUserTranslateKey(str)
          return key ? { ...def, description: this.localize$(get, key, str) } : def
        }
      }),
    )

  public setManifestValue($: Val<string | undefined>, value: string | undefined): void {
    const key = toUserTranslateKey($.value)
    if (key) {
      const locale = localeChain(this.locales, this.ctx.lang$.value)[0] || this.locales['en']
      if (value == null) {
        const { [key]: _, ...data } = locale.data$.value
        locale.data$.set(data)
      } else {
        locale.data$.set({ ...locale.data$.value, [key]: value })
      }
    } else {
      $.set(value)
    }
  }
}

export class Translation implements IDisposable {
  private readonly store: DisposableStore = disposableStore()
  private disposed = false

  public readonly data$: Val<LocaleTextMap>
  public baselineRevision?: Revision
  public readonly onDidChange: AddEventListener<Translation>

  public constructor(
    public readonly translationPath: string,
    private readonly ctx: UserLocalesContext,
  ) {
    this.data$ = this.store.add(val<LocaleTextMap>(Object.create(null), { equal: shallowPlainObjectEqual }))
    this.onDidChange = this.store.add(event())
    this.store.add(this.data$.reaction(send.bind(null, this.onDidChange, this)))
    void this.refresh().catch(console.error)
  }

  public has(key: string): boolean {
    return Object.hasOwn(this.data$.value, key)
  }

  public set(key: string, value: string | null): void {
    if (this.disposed) return
    if (value == null) {
      const { [key]: _, ...data } = this.data$.value
      this.data$.set(data)
    } else {
      this.data$.set({ ...this.data$.value, [key]: value })
    }
  }

  /**
   * @internal
   */
  public _toSaveFileString(): string {
    return JSON.stringify(this.data$.value, null, 2) + '\n'
  }

  public updateSource(snapshot: ManifestSource): void {
    if (this.disposed) return
    if (this.baselineRevision == snapshot.revision) return

    try {
      const raw = JSON.parse(snapshot.source || '{}')
      const data = toPlainObjectOf(raw, isString)
      if (data) {
        this.data$.set(data)
        this.baselineRevision = snapshot.revision
      }
    } catch {
      // ignore
    }
  }

  #refreshId = 0
  public async refresh(): Promise<void> {
    const refreshId = (this.#refreshId = (this.#refreshId + 1) | 0)
    const snapshot = await this.ctx.readFile(this.translationPath, this.baselineRevision)
    if (this.disposed || refreshId !== this.#refreshId || snapshot == unchangedManifestSource) return
    if (snapshot) this.updateSource(snapshot)
  }

  public localize$(get: ComputeGet, key: string): string | undefined {
    const data = get(this.data$)
    return Object.hasOwn(data, key) ? data[key] : undefined
  }

  public localize(key: string): string | undefined {
    return this.localize$(get, key)
  }

  public dispose(): void {
    this.disposed = true
    this.store.dispose()
  }
}

const get: ComputeGet = ($) => (isVal($) ? $.value : $)
