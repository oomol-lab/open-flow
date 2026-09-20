import styles from './valueEditor.module.scss'
import type { ValueControlProps } from './valueControlProps.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { createCodeEditor } from '../../ui/browser/code-editor.ts'
import { Textarea } from '../../ui/browser/textarea.tsx'
import { isJsonValue } from '../common/value.ts'

export function JsonEditor({
  value,
  onChange,
  label,
  disabled,
  path,
  onDraftIssue,
  invalid: schemaInvalid,
  focusRequest = 0,
  autoHeight = false,
  ariaLabel = `${label} JSON`,
}: ValueControlProps & { focusRequest?: number; ariaLabel?: string; autoHeight?: boolean }) {
  const t = useTranslate()
  const lastValue = useRef(value)
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(value === undefined ? '' : JSON.stringify(value, null, 2))
    setInvalid(false)
    onDraftIssue(path, false)
  }, [value, path, onDraftIssue])
  useEffect(() => () => onDraftIssue(path, false), [path, onDraftIssue])
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Awaited<ReturnType<typeof createCodeEditor>>>()
  const [ready, setReady] = useState(false)
  const fallback = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focusRequest || disabled) return
    if (ready) editor.current?.focus()
    else fallback.current?.focus()
  }, [focusRequest, disabled, ready])
  const latest = useRef({ text, disabled, ariaLabel, invalid: false, change: (_nextText: string) => {} })
  const change = (nextText: string) => {
    setText(nextText)
    try {
      const next: unknown = nextText.trim() === '' ? undefined : JSON.parse(nextText)
      if (next !== undefined && !isJsonValue(next)) throw new Error('Not JSON')
      setInvalid(false)
      onDraftIssue(path, false)
      lastValue.current = next
      onChange(next)
    } catch {
      setInvalid(true)
      onDraftIssue(path, true)
    }
  }
  latest.current = { text, disabled, ariaLabel, invalid: invalid || schemaInvalid === true, change }
  useEffect(() => {
    let disposed = false
    let current: Awaited<ReturnType<typeof createCodeEditor>> | undefined
    setReady(false)
    void createCodeEditor(host.current!, `form:${path}`, {
      language: 'json',
      setup: 'minimal',
      theme: 'warm',
      wordWrap: 'on',
      // Leave room for the editor border and the surrounding panel padding.
      cursorScrollMargin: autoHeight ? 24 : undefined,
      value: latest.current.text,
      invalid: latest.current.invalid,
      readOnly: latest.current.disabled === true,
      ariaLabel: latest.current.ariaLabel,
    })
      .then((created) => {
        if (disposed) {
          created.dispose()
          return
        }
        current = created
        editor.current = created
        created.setValue(latest.current.text)
        created.updateOptions({
          readOnly: latest.current.disabled === true,
          ariaLabel: latest.current.ariaLabel,
          invalid: latest.current.invalid,
        })
        created.onChange(() => {
          const next = created.getValue()
          if (next !== latest.current.text) latest.current.change(next)
        })
        setReady(true)
      })
      .catch(() => {
        // The textarea remains usable if the lazy editor bundle cannot load.
      })
    return () => {
      disposed = true
      current?.dispose()
      editor.current = undefined
    }
  }, [path, autoHeight])
  useEffect(() => {
    editor.current?.setValue(text)
    editor.current?.updateOptions({ readOnly: disabled === true, ariaLabel, invalid: latest.current.invalid })
  }, [text, disabled, ariaLabel, invalid, schemaInvalid, ready])
  return (
    <div className={styles.errorAnchor}>
      <div ref={host} className={styles.jsonCode} data-auto-height={autoHeight || undefined} hidden={!ready} />
      {!ready && (
        <Textarea
          ref={fallback}
          aria-label={ariaLabel}
          aria-invalid={invalid || schemaInvalid}
          readOnly={disabled}
          className={styles.json}
          data-auto-height={autoHeight || undefined}
          value={text}
          onChange={(event) => change(event.target.value)}
        />
      )}
      {invalid && (
        <p role="alert" className={styles.error}>
          {t('valueEditor.invalidJson')}
        </p>
      )}
    </div>
  )
}
