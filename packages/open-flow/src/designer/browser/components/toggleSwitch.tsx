import styles from './toggleSwitch.module.scss'
import type { BooleanLabel } from './checkbox.tsx'

import { clsx } from 'clsx'
import { useCallback, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Switch } from '../../../ui/browser/switch.tsx'
import { DesignerTooltip } from './tooltip.tsx'

export interface LabeledSwitchProps {
  className?: string
  style?: React.CSSProperties

  disabled?: boolean
  defaultChecked?: boolean
  checked?: boolean
  onClear?: () => void
  onChange?: (checked: boolean) => void

  // Show at the left side of the row, the switcher is at the right side.
  label?: React.ReactNode | BooleanLabel
  title?: string
  isSuffix?: boolean
}

function isConfig(label: LabeledSwitchProps['label']): label is BooleanLabel {
  return Boolean(label && typeof label === 'object' && ('true' in label || 'false' in label))
}

function renderLabel(label: LabeledSwitchProps['label'], checked?: boolean) {
  if (isConfig(label)) {
    return checked ? label.true : label.false
  }
  return label
}

export function LabeledSwitch(props: LabeledSwitchProps): React.ReactElement {
  const t = useTranslate()
  const isControlled = props.checked !== undefined
  const [internalChecked, setInternalChecked] = useState(props.defaultChecked ?? false)
  const inputId = useId()

  const checked = isControlled ? props.checked : internalChecked
  const onCheckedChange = useCallback(
    (nextChecked: boolean) => {
      if (!isControlled) setInternalChecked(nextChecked)
      props.onChange?.(nextChecked)
    },
    [isControlled, props.onChange],
  )

  return (
    <DesignerTooltip placement="top" title={props.title}>
      <div className={clsx(props.className, styles.wrapper, props.isSuffix && styles.isSuffix)} style={props.style}>
        <div className={styles.content}>
          <label className={styles.label} htmlFor={inputId} title={props.title}>
            {renderLabel(props.label, checked)}
          </label>
          <Switch checked={checked} disabled={props.disabled} id={inputId} onCheckedChange={onCheckedChange} size="sm" />
        </div>
        {props.onClear && (
          <div className={styles.clearWrapper}>
            <Button aria-label={t('components.clear')} className={styles.clear} onClick={props.onClear} size="icon-xs" variant="ghost">
              <i className="i-codicon:close" />
            </Button>
            <div className={styles.clearIndicator} />
          </div>
        )}
      </div>
    </DesignerTooltip>
  )
}
