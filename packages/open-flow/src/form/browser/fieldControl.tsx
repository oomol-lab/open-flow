import styles from './valueEditor.module.scss'
import type { ReactNode } from 'react'

import { useId } from 'react'

/** Gives custom value controls the same attached validation feedback as built-in editors. */
export function ValueEditorFeedback({ children, error }: { readonly children: (errorId: string | undefined) => ReactNode; readonly error?: ReactNode }) {
  const id = useId()
  const errorId = error == null ? undefined : `${id}-error`
  return (
    <div className={styles.errorAnchor}>
      {children(errorId)}
      {error != null && (
        <div id={errorId} className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/** A custom value control uses the same attached source layout as schema editors. */
export function ValueControl({ addon, children }: { addon?: ReactNode; children: ReactNode }) {
  if (addon == null) return children
  return (
    <div className={styles.root} data-inline data-value-addon={addon != null || undefined}>
      {addon != null && (
        <div className={styles.valueAddon} data-value-addon-control>
          {addon}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
}
