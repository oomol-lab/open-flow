import styles from './textPreview.module.scss'
import type { ReadonlyVal } from 'value-enhancer'
import type { StringEditorFactory } from '../textareaStringEditor.ts'

import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'

export interface TextPreviewProps {
  readonly dark$: ReadonlyVal<boolean>
  readonly data: unknown
  readonly editorFactory: StringEditorFactory
  readonly language?: string | undefined
}

export function formatPreviewText(data: unknown): string {
  if (typeof data == 'string') return data
  if (data == null) return ''
  try {
    return JSON.stringify(data, null, 2) ?? String(data)
  } catch {
    try {
      return String(data)
    } catch {
      return '<Data is not previewable>'
    }
  }
}

export function TextPreview({ dark$, data, editorFactory, language }: TextPreviewProps): React.ReactElement {
  const t = useTranslate()
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [focused, setFocused] = useState(false)
  const source = formatPreviewText(data)

  useEffect(() => {
    if (failed) return
    const parent = container.current
    if (parent == null) return
    let disposed = false
    let editor: Awaited<ReturnType<StringEditorFactory['create']>> | undefined
    void editorFactory
      .create(parent, `open-flow://preview/${crypto.randomUUID()}`, {
        ariaLabel: t('preview.textAriaLabel'),
        automaticLayout: true,
        domReadOnly: true,
        language: language ?? 'plaintext',
        minimap: { enabled: false },
        readOnly: true,
        value: source,
        wordWrap: 'on',
      })
      .then((value) => {
        if (disposed) {
          value.dispose()
        } else {
          editor = value
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      editor?.dispose()
    }
  }, [dark$, editorFactory, failed, language, source, t])

  if (failed) {
    return (
      <pre className={styles.fallback} data-language={language}>
        {source}
      </pre>
    )
  }

  return (
    <div
      ref={container}
      className={clsx(styles.preview, 'nodrag', focused && 'nowheel', focused && 'designer-preview-active')}
      data-language={language}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    />
  )
}
