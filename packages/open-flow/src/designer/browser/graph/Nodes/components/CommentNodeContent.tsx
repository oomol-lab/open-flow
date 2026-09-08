import styles from './CommentNodeContent.module.scss'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { clsx } from 'clsx'
import { useLayoutEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'

export function CommentNodeContent({ store }: { store: CommentNodeStore }): React.ReactElement {
  const [div, setDiv] = useState<HTMLDivElement | null>(null)
  const preview = useVal(store.$.preview)
  const showCode = useVal(store.$.sourceCode)

  useLayoutEffect(() => {
    if (div) {
      const unmount = store.mountCodeEditor(div, store.$$.content, store.$.lang, store.userLocales)

      return () => {
        if (unmount) setTimeout(() => unmount(), 0)
      }
    }
  }, [div, store])

  return (
    <div className={clsx(styles.container, showCode && styles.sourceCode, !showCode && NODE_HANDLE_CLASSNAME)}>{showCode ? <div ref={setDiv} /> : preview}</div>
  )
}
