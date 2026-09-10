import styles from './markdownPreview.module.scss'
import type { FC } from 'react'
import type { Components } from 'react-markdown'

import { clsx } from 'clsx'
import { lazy, memo, Suspense, useState } from 'react'

const MarkdownContent = lazy(() => import('../../../ui/browser/markdown/markdownContent.tsx'))

export interface MarkdownPreviewProps {
  dark: boolean
  components?: Components
  unstyled?: boolean
  contentClassName?: string
  content: string
  draggable?: boolean
  onDoubleClick?: () => void
}

export const MarkdownPreview: FC<MarkdownPreviewProps> = /* @__PURE__ */ memo(
  ({ dark, unstyled, components, contentClassName, content, draggable, onDoubleClick }) => {
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
            <MarkdownContent components={components} dark={dark} unstyled={unstyled} className={contentClassName} text={content} mermaid />
          </Suspense>
        </div>
      </div>
    )
  },
)
