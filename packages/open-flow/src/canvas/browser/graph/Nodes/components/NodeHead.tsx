import styles from './NodeHead.module.scss'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Input } from '../../../components/input.tsx'

export function CommentTitle({ store }: { readonly store: CommentNodeStore }) {
  const t = useTranslate()
  const title = useVal(store.$.title)
  const [focused, setFocused] = useState(false)
  return (
    <Input
      returnToCommit
      doubleClickToSelect
      className={`${styles.title}${focused ? ' nodrag' : ''}`}
      value={title}
      title={title}
      placeholder={t('blockEditor.nodeTitlePlaceholder')}
      onRealChange={store.$$.title.set}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  )
}
