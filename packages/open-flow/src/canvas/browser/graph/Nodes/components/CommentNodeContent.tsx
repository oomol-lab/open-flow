import styles from './CommentNodeContent.module.scss'
import type { Components } from 'react-markdown'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { clsx } from 'clsx'
import { useContext, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Checkbox } from '../../../../../ui/browser/checkbox.tsx'
import { Textarea } from '../../../../../ui/browser/textarea.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { MarkdownPreview } from '../../../preview/markdownPreview.tsx'
import { COMMENT_MINIMUM_SIZE } from '../../../stores/node/commentNode.store.ts'
import { CanvasDarkContext, useCanvasStore } from '../../CanvasStoreContext.tsx'
import { NodeResizeHandle } from './NodeResizeHandle.tsx'

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
  const size = useVal(store.$.size)
  return (
    <NodeResizeHandle
      className={styles.resizeButton}
      label={t('comment.resize')}
      position="bottom-right"
      minimum={COMMENT_MINIMUM_SIZE}
      size={size}
      onResize={store.resize}
    >
      <i aria-hidden="true" className="i-mdi:resize-bottom-right" />
    </NodeResizeHandle>
  )
}
