import styles from './range.module.scss'

import { clsx } from 'clsx'
import { forwardRef, useCallback, useRef, useState } from 'react'
import { Button } from '../../../ui/browser/button.tsx'
import { useIsMounted } from '../../../ui/browser/hooks.ts'
import { Input } from '../../../ui/browser/input.tsx'
import { clamp } from '../base/trivial.ts'

export interface RangeProps {
  className?: string
  style?: React.CSSProperties
  min?: number
  max?: number
  step?: number
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  disabled?: boolean
  label?: string
  title?: string
  progress?: boolean
  isSuffix?: boolean
}

function format(value: number, step?: number): string {
  const precision = step == null || step == 0 ? 2 : (String(step).split('.')[1]?.length ?? 0)
  return value.toFixed(precision)
}

function getProgress(value: number, min = 0, max = Infinity): number {
  // Return 0 if it's NaN.
  return clamp((value - min) / (max - min), 0, 1) || 0
}

function startDragging(ev0: React.PointerEvent, target: HTMLElement, callback: (dx: number, click?: boolean) => void): () => void {
  let checkingClick = true
  const startX = ev0.clientX

  const onPointerMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    if (checkingClick && Math.abs(dx) > 2) {
      checkingClick = false
    }
    if (!checkingClick) callback(dx)
  }

  const done = () => {
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointerleave', done)
  }

  const onPointerUp = () => {
    if (checkingClick) {
      callback(0, true)
      checkingClick = false
    }
    done()
  }

  target.setPointerCapture(ev0.pointerId)
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointerleave', done)

  return done
}

export const Range: React.FC<RangeProps> = /*#__PURE__*/ forwardRef(function Range(props: RangeProps, ref?: React.Ref<HTMLInputElement>) {
  const isMounted = useIsMounted()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [showInput, setShowInput] = useState(false)

  const isControlled = props.value !== undefined
  const [internalValue, setInternalValue] = useState(props.defaultValue || 0)

  const value = props.value ?? internalValue
  const onChange = useCallback(
    (nextValue: number) => {
      if (!isControlled) setInternalValue(nextValue)
      props.onChange?.(nextValue)
    },
    [isControlled, props.onChange],
  )

  const progress = getProgress(value, props.min, props.max)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const onPointerDown = useCallback((ev: React.PointerEvent<HTMLElement>) => {
    const data = ev.currentTarget.dataset
    const rect = ev.currentTarget.getBoundingClientRect()
    const v0 = Number(data.value) || 0
    const min = Number(data.min) || 0
    const max = Number(data.max) || Infinity
    const step = Number(data.step) || 0
    const range = Number.isFinite(max - min) ? max - min : 0
    const factor = (range && range / rect.width) || 1

    const stopDragging = startDragging(ev, ev.currentTarget, (dx, click) => {
      if (!isMounted()) {
        stopDragging()
        return
      }
      if (click) {
        setShowInput(true)
        setTimeout(() => wrapperRef.current?.querySelector('input')?.focus())
        return
      }
      let newValue = clamp(v0 + dx * factor, min, max)
      if (step > 0) {
        newValue = Math.round(newValue / step) * step
      }
      onChangeRef.current?.(Number(format(newValue, step)))
    })
  }, [])

  const onInputKeyDown = useCallback((ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === 'Escape') {
      setShowInput(false)
      setTimeout(() => {
        wrapperRef.current?.querySelector<HTMLElement>(`.${styles.slider}`)?.focus()
      })
    }
  }, [])

  const onArrowClick = useCallback(
    (ev: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, amount = Number(ev.currentTarget.dataset.amount) || 1) => {
      const min = props.min || 0
      const max = props.max || Infinity
      const step = props.step || 1
      if (ev.shiftKey) amount *= 5
      let newValue = clamp(value + amount * step, min, max)
      if (step > 0) {
        newValue = Math.round(newValue / step) * step
      }
      onChange?.(Number(format(newValue, step)))
    },
    [value, props.min, props.max, props.step, onChange],
  )

  const onSliderKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLElement>) => {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
        onArrowClick(ev, -1)
      } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
        onArrowClick(ev, +1)
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        setShowInput(true)
        setTimeout(() => wrapperRef.current?.querySelector('input')?.focus())
      }
    },
    [onArrowClick],
  )

  const onInputChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = ev.target.valueAsNumber
      if (Number.isFinite(nextValue)) {
        onChange?.(Number(format(nextValue, props.step)))
      }
    },
    [props.step, onChange],
  )

  return (
    <div
      ref={wrapperRef}
      className={clsx(styles.wrapper, props.isSuffix && styles.isSuffix, props.disabled && styles.disabled)}
      style={{ ['--progress' as any]: progress }}
    >
      <div className={styles.progress} />
      <div className={styles.display} title={props.title || props.label}>
        <Button data-amount={-1} disabled={props.disabled} onClick={onArrowClick} size="icon-xs" variant="ghost">
          <i className="i-codicon:chevron-left" />
        </Button>
        <div
          className={styles.slider}
          tabIndex={props.disabled ? void 0 : 0}
          data-value={value}
          data-min={props.min}
          data-max={props.max}
          data-step={props.step}
          onPointerDown={props.disabled ? void 0 : onPointerDown}
          onKeyDown={props.disabled ? void 0 : onSliderKeyDown}
        >
          <span className={styles.label}>{props.label}</span>
          <span className={styles.value}>{format(value, props.step)}</span>
        </div>
        <Button data-amount={+1} disabled={props.disabled} onClick={onArrowClick} size="icon-xs" variant="ghost">
          <i className="i-codicon:chevron-right" />
        </Button>
      </div>
      {showInput && (
        <Input
          type="number"
          ref={ref}
          className={props.className}
          style={props.style}
          min={props.min}
          max={props.max}
          step={props.step}
          defaultValue={value.toFixed(2)}
          onChange={onInputChange}
          disabled={props.disabled}
          onBlur={() => setShowInput(false)}
          onKeyDown={onInputKeyDown}
        />
      )}
    </div>
  )
})
