import styles from './input2.module.scss'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { LocaleTextStore } from '../../../localization/common/localization.ts'
import type { InputProps } from './input.tsx'
import type { TranslateKeyEvent } from './userLocales.tsx'

import { send } from '@wopjs/event'
import { clsx } from 'clsx'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { compute } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../base/common/equality.ts'
import { Button } from '../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../ui/browser/dropdown-menu.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/browser/popover.tsx'
import { fixTranslateKey, generateTranslateKey, getOwnValue, isBannedName, toUserTranslateKey } from '../base/trivial.ts'
import { useGetStaticPopupContainer } from '../graph/ReactFlowContainer/useGetPopupContainer.ts'
import { getProperLocale$ } from '../stores/designer/l10n.ts'
import { Input } from './input.tsx'
import { useUserLocalesContext } from './userLocales.tsx'

export interface TranslationInputProps extends Omit<InputProps, 'value' | 'onChange' | 'onRealChange'> {
  rawValue$?: Val<string | undefined>
  displayValue$: ReadonlyVal<string | undefined>
  useRealChange?: boolean
  /** With a hint, translation key generation only resolves duplicate names. */
  translateKeyHint?: string
  translationFallback?: string
}

/** A `%key%` `rawValue$` resolves its display value through `userLocales`. */
export const TranslationInput: React.FC<TranslationInputProps> = /*#__PURE__*/ memo(function TranslationInput({
  className,
  rawValue$,
  displayValue$,
  useRealChange,
  translateKeyHint,
  translationFallback,
  ...props
}: TranslationInputProps) {
  const currentLang = useLang()
  const l10n = useUserLocalesContext()
  const rawValue = useVal(rawValue$)
  const displayValue = useVal(displayValue$)
  const translateKey = toUserTranslateKey(rawValue)
  const [focused, setFocused] = useState(false)
  const [localeFocused, setLocaleFocused] = useState(false)
  const [localeOpen, setLocaleOpen] = useState(false)
  const focusedValue = translateKey != null ? displayValue : rawValue$ ? rawValue : (rawValue ?? displayValue)

  const onChange = (value: string) => {
    if (translateKey == null || l10n?.userLocales == null || l10n.userLocales[currentLang] == null) {
      rawValue$?.set(value)
    } else {
      const locale$ = l10n.userLocales[currentLang]
      locale$.set({ ...locale$.value, [translateKey]: value })
    }
  }

  const onDeleteKey = () => {
    if (!l10n || !translateKey) return
    const { onDidChangeTranslateKey } = l10n
    let events: TranslateKeyEvent[] | undefined
    let oldValue: string | undefined
    for (const locale in l10n.userLocales) {
      if (Object.hasOwn(l10n.userLocales, locale) && l10n.userLocales[locale]) {
        oldValue ||= getOwnValue(l10n.userLocales[locale].value, translateKey)
        if (onDidChangeTranslateKey) {
          events ||= []
          events.push({ lang: locale, oldKey: translateKey, newKey: null })
        }
      }
    }
    if (rawValue$) {
      rawValue$.set(oldValue)
      if (events && onDidChangeTranslateKey) {
        events.forEach((event) => send(onDidChangeTranslateKey, event))
      }
    }
    setLocaleOpen(false)
  }

  const onChangeKey = (newKey: string) => {
    if (!l10n || !newKey || !translateKey || newKey === translateKey) return
    if (isBannedName(newKey)) return
    const { onDidChangeTranslateKey } = l10n
    let events: TranslateKeyEvent[] | undefined
    for (const locale in l10n.userLocales) {
      if (Object.hasOwn(l10n.userLocales, locale) && l10n.userLocales[locale]) {
        const locale$ = l10n.userLocales[locale]
        const translation = locale$.value
        const oldValue: string | undefined = getOwnValue(translation, translateKey)
        if (translation[newKey] != null) {
          // Preserve an existing translation.
        } else if (oldValue != null) {
          // Copy the old value to the new key while retaining the old key.
          locale$.set({ ...translation, [newKey]: oldValue })
        }
        if (onDidChangeTranslateKey) {
          events ||= []
          events.push({ lang: locale, oldKey: translateKey, newKey })
        }
      }
    }
    if (rawValue$?.value === `%${translateKey}%`) {
      rawValue$.set(`%${newKey}%`)
      if (events && onDidChangeTranslateKey) {
        events.forEach((event) => send(onDidChangeTranslateKey, event))
      }
    }
  }

  function renderTranslateButton(editableValue$: Val<string | undefined>, userLocales: LocaleTextStore) {
    return (
      <TranslateButton
        open={localeOpen}
        onOpen={setLocaleOpen}
        onFocus={setLocaleFocused}
        onDeleteKey={onDeleteKey}
        onChangeKey={onChangeKey}
        rawValue$={editableValue$}
        displayValue={displayValue}
        userLocales={userLocales}
        translateKey={translateKey}
        multiline={props.multiline}
        translateKeyHint={translateKeyHint}
        translationFallback={translationFallback}
      />
    )
  }

  let suffix: React.ReactNode
  if (rawValue$ && l10n?.userLocales) {
    if (props.suffix) {
      suffix = (
        <>
          {renderTranslateButton(rawValue$, l10n.userLocales)}
          {props.suffix}
        </>
      )
    } else {
      suffix = renderTranslateButton(rawValue$, l10n.userLocales)
    }
  }

  return (
    <Input
      {...props}
      className={clsx(className, focused && 'nodrag')}
      readOnly={!rawValue$}
      value={focused ? focusedValue : displayValue}
      title={focused ? focusedValue : displayValue}
      onChange={useRealChange ? undefined : onChange}
      onRealChange={useRealChange ? onChange : undefined}
      onFocus={() => {
        setFocused(true)
        // Open the translation panel when this value already has a translation key.
        if (translateKey != null) setLocaleOpen(true)
      }}
      // Delay losing focus because input blur fires before the button receives focus.
      onBlur={() => setTimeout(() => setFocused(false))}
      suffix={focused || localeOpen || localeFocused ? suffix : props.suffix}
    />
  )
})

interface TranslateButtonProps {
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly onFocus: (focused: boolean) => void
  readonly onDeleteKey: () => void
  readonly onChangeKey: (key: string) => void
  readonly rawValue$: Val<string | undefined>
  readonly displayValue?: string
  readonly multiline?: boolean
  readonly userLocales: LocaleTextStore
  readonly translateKey?: string
  readonly translateKeyHint?: string
  readonly translationFallback?: string
}

const Languages: string[] = ['en', 'zh-CN']

interface Translations {
  readonly [lang: string]: string | undefined
}

function getTranslations(userLocales: LocaleTextStore, get: ComputeGet, translateKey: string | undefined): Translations {
  const result: { [lang: string]: string | undefined } = {}
  for (const lang of Languages) {
    const locale = get(userLocales[lang])
    if (translateKey != null && locale) {
      result[lang] = getOwnValue(locale, translateKey)
    }
  }
  return result
}

function TranslateButton({
  open,
  onOpen,
  onFocus,
  onDeleteKey,
  onChangeKey,
  rawValue$,
  displayValue,
  multiline,
  userLocales,
  translateKey,
  translateKeyHint,
  translationFallback,
}: TranslateButtonProps): React.ReactElement {
  const t = useTranslate()
  const currentLang = useLang()
  const getPopupContainer = useGetStaticPopupContainer()

  const translations$ = useMemo(
    () => compute((get) => getTranslations(userLocales, get, translateKey), { equal: shallowPlainObjectEqual }),
    [userLocales, translateKey],
  )

  const translations = useVal(translations$)

  const onChange = useCallback(
    (value: string, targetLang: string) => {
      if (translateKey) {
        const locale$ = userLocales[targetLang] ?? userLocales.en
        locale$.set({ ...locale$.value, [translateKey]: value })
      }
    },
    [userLocales, translateKey],
  )

  const onCreateKey = useCallback(
    (value: string, targetLang: string) => {
      const locale$ = getProperLocale$(userLocales, targetLang, value)
      let newTranslateKey: string
      if (translateKeyHint) {
        newTranslateKey = fixTranslateKey(translateKeyHint, locale$.value)
      } else {
        newTranslateKey = generateTranslateKey(value, locale$.value)
      }
      locale$.set({ ...locale$.value, [newTranslateKey]: value })
      rawValue$.set(`%${newTranslateKey}%`)
      // Reopen the translation panel after Dropdown has applied its close state.
      setTimeout(() => onOpen(true))
    },
    [userLocales, rawValue$, onOpen, translateKeyHint],
  )

  const keyInputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string>()

  if (translateKey == null) {
    return (
      <DropdownMenu open={open} onOpenChange={(nextOpen) => onOpen(nextOpen)}>
        <DropdownMenuTrigger
          render={
            <Button
              title={t('l10n.createKey')}
              className={clsx(styles.translateButton, 'oo-designer-translate-btn')}
              onBlur={() => onFocus(false)}
              onFocus={() => onFocus(true)}
              size="icon-xs"
              variant="ghost"
            >
              <i className="i-carbon:translate" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className={styles.translateMenu} container={getPopupContainer()} side="bottom" sideOffset={0}>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onCreateKey(resolveTranslationSeed(displayValue, translationFallback), currentLang)}>
              {t('l10n.createKey')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Focus the first language without a translation by default.
  const autoFocusLang = Languages.find((language) => !translations[language]) || 'en'

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && keyInputRef.current?.value === '') {
          onDeleteKey()
        } else {
          onOpen(nextOpen)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            title={t('l10n.openPanel')}
            className={clsx(styles.translateButton, 'oo-designer-translate-btn')}
            onBlur={() => onFocus(false)}
            onFocus={() => onFocus(true)}
            size="icon-xs"
            variant="ghost"
          >
            <i className="i-carbon:translate" />
          </Button>
        }
      />
      <PopoverContent align="end" className={styles.translatePanel} container={getPopupContainer()} side="bottom" sideOffset={0}>
        <div className={styles.translations}>
          <div className={styles.translateKey} title={translateKey}>
            <div className={styles.translateKeyId}>{t('l10n.translateKey')}</div>
            <div className={styles.translateKeyValue}>
              <Input
                ref={keyInputRef}
                className={styles.translateKeyInput}
                value={translateKey}
                warning={error}
                // Show validation beside the edited key without creating a competing focus overlay.
                placeholder={error}
                isClearable
                onChange={(key: string | null, setValue) => {
                  if (key == null) {
                    // Leave the value empty so closing the Popover triggers `onDeleteKey`.
                    setValue((key = ''))
                  }
                  setError(isBannedName(key) ? t('l10n.invalidKey') : key ? undefined : t('l10n.emptyKey'))
                }}
                onRealChange={onChangeKey}
              />
            </div>
          </div>
          {Languages.map((language) => (
            <div key={language} data-lang={language} className={styles.translation}>
              <div className={styles.language}>{t(`l10n.${language}`)}</div>
              <TranslationValueInput
                autoFocus={autoFocusLang === language}
                multiline={multiline}
                lang={language}
                translations={translations}
                onChange={onChange}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function resolveTranslationSeed(value: string | undefined, fallback: string | undefined): string {
  return value || fallback || ''
}

interface TranslationValueInputProps {
  readonly autoFocus?: boolean
  readonly multiline?: boolean
  readonly lang: string
  readonly translations: Translations
  readonly onChange: (value: string, lang: string) => void
}

function TranslationValueInput({ autoFocus, multiline, lang, translations, onChange }: TranslationValueInputProps) {
  const t = useTranslate()

  return (
    <Input
      autoFocus={autoFocus}
      multiline={multiline}
      className={styles.translationInput}
      placeholder={t('inputHandleEditor.unset')}
      value={translations[lang]}
      onRealChange={(value) => onChange(value, lang)}
    />
  )
}
