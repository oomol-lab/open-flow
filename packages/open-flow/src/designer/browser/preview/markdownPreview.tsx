import styles from './markdownPreview.module.scss'
import type { FC } from 'react'

import { clsx } from 'clsx'
import { lazy, memo, Suspense, useState } from 'react'

const MarkdownContent = lazy(() => import('../../../ui/browser/markdown/markdownContent.tsx'))

export interface MarkdownPreviewProps {
  dark: boolean
  content: string
  draggable?: boolean
  onDoubleClick?: () => void
}

export const MarkdownPreview: FC<MarkdownPreviewProps> = /* @__PURE__ */ memo(({ dark, content, draggable, onDoubleClick }) => {
  const [focus, setFocus] = useState(false)
  return (
    <div
      tabIndex={-1}
      className={clsx(styles.container, draggable ? styles.draggable : 'nodrag', focus && 'nowheel')}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onDoubleClick={onDoubleClick}
    >
      <div className={`${styles.body} markdown-body`}>
        <Suspense fallback={null}>
          <MarkdownContent dark={dark} text={content} mermaid />
        </Suspense>
      </div>
    </div>
  )
})
