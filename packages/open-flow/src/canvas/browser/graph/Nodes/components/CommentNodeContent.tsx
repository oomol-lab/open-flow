import styles from './CommentNodeContent.module.scss'
import type { Components } from 'react-markdown'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { clsx } from 'clsx'
import { useContext } from 'react'
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
  const showCode = useVal(store.$.sourceCode)
  const content = useVal(store.$$.content)
  const editable = useVal(useCanvasStore().$.editable)

  return (
    <div className={`${styles.body} nopan`}>
      <div className={clsx(styles.container, showCode && styles.sourceCode, !showCode && NODE_HANDLE_CLASSNAME)}>
        {showCode ? (
          <Textarea
            aria-label={t('comment.source')}
            autoFocus
            disabled={!editable}
            className="min-h-30 resize-y rounded-none border-0 bg-transparent p-0 text-inherit shadow-none focus-visible:ring-0"
            value={content ?? ''}
            onChange={(event) => store.$$.content.set(event.target.value)}
            onBlur={(event) => {
              if (editable) store.saveContent(event.target.value)
            }}
          />
        ) : (
          <MarkdownPreview
            components={markdownComponents}
            unstyled
            contentClassName={styles.markdown}
            content={content ?? ''}
            dark={dark}
            draggable
            onDoubleClick={store.togglePreview}
          />
        )}
      </div>
    </div>
  )
}
