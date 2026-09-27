import styles from './CommentNodeContent.module.scss'
import type { Components } from 'react-markdown'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useStoreApi } from '@xyflow/react'
import { clsx } from 'clsx'
import { useContext, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Checkbox } from '../../../../../ui/browser/checkbox.tsx'
import { Textarea } from '../../../../../ui/browser/textarea.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { MarkdownPreview } from '../../../preview/markdownPreview.tsx'
import { CanvasDarkContext, useCanvasStore } from '../../CanvasStoreContext.tsx'

const markdownComponents: Components = {
  input: ({ type, checked }) => (type === 'checkbox' ? <Checkbox className={styles.taskCheckbox} checked={checked ?? false} readOnly tabIndex={-1} /> : null),
}

export function CommentNodeContent({ store }: { store: CommentNodeStore }): JSX.Element | null {
  const t = useTranslate()
  const dark = useContext(CanvasDarkContext)
  const sourceCode = useVal(store.$.sourceCode)
  const empty = useVal(store.$.empty)
  const content = useVal(store.$$.content)
  const editable = useVal(useCanvasStore().$.editable)
  const selected = useVal(store.$.selected)
  const showCode = editable && (sourceCode || (empty && selected))
  const previousSelected = useRef(selected)
  const restorePreview = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [composing, setComposing] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (previousSelected.current && !selected) restorePreview.current = true
    previousSelected.current = selected
    if (selected) restorePreview.current = false
    // Keep the editor mounted until the IME has delivered its final text.
    if (!restorePreview.current || composing) return
    restorePreview.current = false
    if (store.$.sourceCode.value) {
      if (editable) store.saveContent(textarea.current?.value ?? store.$.content.value ?? '')
      store.$$.sourceCode.set(false)
    }
  }, [selected, composing, editable, store])

  return (
    <div className={`${styles.body} nopan nowheel`}>
      <div className={clsx(styles.container, showCode && styles.sourceCode, !showCode && NODE_HANDLE_CLASSNAME)}>
        {showCode ? (
          <Textarea
            ref={textarea}
            aria-label={t('comment.source')}
            autoFocus={sourceCode || (empty && !!selected)}
            onFocus={() => {
              setFocused(true)
              store.$$.sourceCode.set(true)
            }}
            disabled={!editable}
            className={clsx(
              'h-full min-h-0 field-sizing-fixed resize-none rounded-none border-0 bg-transparent px-3.5 py-3 text-inherit shadow-none focus-visible:outline-none',
              focused && 'nodrag',
            )}
            value={content ?? ''}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              store.$$.content.set(event.currentTarget.value)
              setComposing(false)
            }}
            onChange={(event) => store.$$.content.set(event.target.value)}
            onBlur={(event) => {
              setFocused(false)
              if (editable && !composing) store.saveContent(event.target.value)
            }}
          />
        ) : (
          <MarkdownPreview components={markdownComponents} unstyled contentClassName={styles.markdown} content={content ?? ''} dark={dark} draggable />
        )}
      </div>
      {editable && <CommentResizeButton store={store} />}
    </div>
  )
}

function CommentResizeButton({ store }: { readonly store: CommentNodeStore }) {
  const t = useTranslate()
  const reactFlow = useStoreApi()
  const drag = useRef<{ x: number; y: number; width: number; height: number; zoom: number } | null>(null)
  return (
    <button
      type="button"
      className={`${styles.resizeButton} nodrag nopan`}
      aria-label={t('comment.resize')}
      title={t('comment.resize')}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, ...store.$.size.value, zoom: reactFlow.getState().transform[2] }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        store.resize({ width: start.width + (event.clientX - start.x) / start.zoom, height: start.height + (event.clientY - start.y) / start.zoom })
      }}
      // Pointer capture ends on release or cancellation, including outside the button.
      onLostPointerCapture={() => {
        drag.current = null
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10
        const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as const)[event.key]
        if (!delta) return
        event.preventDefault()
        event.stopPropagation()
        const size = store.$.size.value
        store.resize({ width: size.width + delta[0], height: size.height + delta[1] })
      }}
    >
      <i aria-hidden="true" className="i-mdi:resize-bottom-right" />
    </button>
  )
}
