import styles from './specialValue.module.scss'
import type { JSX } from 'react/jsx-runtime'

import { useTranslate } from 'val-i18n-react'

export interface SpecialValueProps {
  type: string
  value?: string
}

export const SpecialValue = ({ type, value }: SpecialValueProps): JSX.Element => {
  const t = useTranslate()
  let title = type
  let icon = ''

  if (type == 'bin') {
    title = t('jsonViewer.bin')
    value = `${title}…`
    icon = 'i-carbon:transform-binary'
  }

  return (
    <span title={title} className={styles.container}>
      {icon && <i className={`${icon} ${styles.icon}`} />}
      {value}
    </span>
  )
}

export const getSpecialValueKind = (type: string): string => {
  switch (type) {
    case 'oomol/bin':
      return 'bin'
    default:
      return type
  }
}
