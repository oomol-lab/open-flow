import styles from './NodeContentRows.module.scss'
import type { ReactNode } from 'react'

export function NodeContentRows({ children }: { readonly children: ReactNode }) {
  return <ul className={styles.rows}>{children}</ul>
}
