import styles from './iframePreview.module.scss'
import type { FC } from 'react'
import type { ReadonlyVal } from 'value-enhancer'

import { listen } from '@wopjs/dom'
import { clsx } from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { getIframeSandbox } from './iframePolicy.ts'

export interface IframePreviewProps {
  src?: string
  data?: string
  className?: string
  iframeClassName?: string
  title?: string
  nodeSelected$?: ReadonlyVal<boolean | undefined>
  dark$: ReadonlyVal<boolean>
}

export const IframePreview: FC<IframePreviewProps> = ({ src, data: html, className, iframeClassName, nodeSelected$, dark$, title }) => {
  const t = useTranslate()
  const [focus, setFocus] = useState(false)

  useEffect(() => nodeSelected$?.subscribe((selected) => !selected && setFocus(false)), [nodeSelected$])

  useEffect(() => listen(window, 'pointerup', () => setFocus(false), true), [])

  const sheetRef = useRef<CSSStyleSheet | null>(null)

  useEffect(
    () =>
      dark$.reaction((dark) => {
        sheetRef.current?.replaceSync(`:where(html) { color-scheme: ${dark ? 'dark' : 'light'}; }`)
      }),
    [dark$],
  )

  const onLoad = useCallback(
    (e: { readonly currentTarget: HTMLIFrameElement }) => {
      if (html != null) {
        sheetRef.current = null
        return
      }
      const iframe = e.currentTarget
      const w = iframe.contentWindow
      if (w) {
        try {
          const sheet = new (w as Window & typeof globalThis).CSSStyleSheet()
          sheet.replaceSync(`:where(html) { color-scheme: ${dark$.value ? 'dark' : 'light'}; }`)
          sheetRef.current = sheet
          w.document.adoptedStyleSheets = [...w.document.adoptedStyleSheets, sheet]
        } catch {
          sheetRef.current = null
        }
      }
    },
    [dark$, html],
  )

  return (
    <div className={className}>
      <iframe
        className={clsx(styles.iframe, focus && 'designer-preview-active', iframeClassName)}
        onBlur={() => setFocus(false)}
        onFocus={() => setFocus(true)}
        src={src}
        srcDoc={html}
        sandbox={getIframeSandbox(html != null)}
        title={title ?? t('preview.title')}
        onLoad={onLoad}
      />
    </div>
  )
}
