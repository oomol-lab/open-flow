import styles from './input.module.scss'

import { clsx } from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../../../ui/browser/button.tsx'
import { forwardRef2 } from '../../../ui/browser/hooks.ts'
import { stopEvent } from '../base/dom.ts'
import { isFunction, MAX_I32 } from '../base/trivial.ts'
import { CanvasTooltip } from './tooltip.tsx'

export interface InputProps<Clear extends boolean = false> {
  id?: string
  ariaInvalid?: boolean
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  type?: React.HTMLInputTypeAttribute
  /** Semi-controlled `input.value` which updates only while the input is clean. */
  value?: string
  min?: number
  max?: number
  step?: number
  autoFocus?: boolean
  onFocus?: (input: HTMLInputElement) => void
  onBlur?: (input: HTMLInputElement) => void
  isClearable?: Clear
  onChange?: Clear extends true ? (value: string | null, setValue: (value: string) => void) => void : (value: string, setValue: (value: string) => void) => void
  /** Listen on the real 'change' event fired on the input element. */
  onRealChange?: (value: string) => void
  placeholder?: string
  title?: string
  disabled?: boolean
  readOnly?: boolean
  /** Change the font to monospace. */
  monospace?: boolean
  /** Render a `<textarea>` if `multiline` is `true`. */
  multiline?: boolean
  /** Enable vertical resizing when `multiline` is `true`. Pass `false` to disable resizing. */
  height?: number | false
  /** Effective when there's no `height`. */
  maxHeight?: number
  /**
   * Textarea height change event when `multiple` is `true`.
   * Only triggers when user manually setting the height, not when auto-fitting height.
   */
  onResize?: (height: number) => void
  /** Click to select all. */
  selectOnFocus?: boolean
  /** Requires double-click to trigger select. */
  doubleClickToSelect?: boolean
  /** Press return/esc to blur element after change event happens. */
  returnToCommit?: boolean | ((input: HTMLInputElement) => void)
  /** Press `up` = -1, `down` = 1, it calls `preventDefault()` if set. */
  onNavigate?: (input: HTMLInputElement, direction: -1 | 1) => void
  isSuffix?: boolean
  warning?: string
}

function selectOnPointerUp(event: { readonly currentTarget: HTMLInputElement; readonly pointerId: number }) {
  const input = event.currentTarget as HTMLInputElement
  if (input && document.activeElement !== input) {
    input.setPointerCapture(event.pointerId)
    document.addEventListener('pointerup', function selectAll() {
      if (input.selectionStart === input.selectionEnd) input.select()
      document.removeEventListener('pointerup', selectAll)
    })
  }
}

export const Input: <Clear extends boolean = false>(props: InputProps<Clear> & React.RefAttributes<HTMLInputElement>) => React.ReactElement | null =
  /*#__PURE__*/ forwardRef2(function Input<Clear extends boolean = false>(props: InputProps<Clear>, ref?: React.Ref<HTMLInputElement>) {
    const [value, setValue] = useState(props.value ?? '')
    const [focused, setFocused] = useState(false)
    const dirtyRef = useRef(false)
    const wrapperRef = useRef<HTMLDivElement>(null)
    // Composition input has more edge cases, but this only guards return-to-commit behavior.
    const composingRef = useRef(false)

    useLayoutEffect(() => {
      if (dirtyRef.current) {
        if (props.value === value) {
          dirtyRef.current = false
        }
      } else {
        setValue(props.value ?? '')
      }
    }, [props.value])

    const sharedProps: React.InputHTMLAttributes<HTMLInputElement> = {
      id: props.id,
      className: clsx(
        styles.input,
        focused && 'nowheel nodrag',
        props.monospace && styles.monospace,
        props.multiline && styles.multiline,
        props.height !== false && styles.resize,
        props.warning && styles.warning,
      ),
      style: {
        height: props.height || void 0,
        maxHeight: props.height ? void 0 : props.maxHeight,
        ...props.style,
      },
      type: props.type,
      value: value,
      min: props.min ?? 0,
      max: props.max ?? MAX_I32,
      step: props.step,
      onFocus: (e) => {
        props.onFocus?.(e.target)
        setFocused(true)
      },
      onBlur: (e) => {
        dirtyRef.current = false
        props.onBlur?.(e.target)
        setFocused(false)
        if (e.target.value !== value) {
          setValue(e.target.value)
        }
      },
      onChange: (e) => {
        dirtyRef.current = true
        setValue(e.target.value)
        props.onChange?.(e.target.value, setValue)
      },
      onPointerDown: props.selectOnFocus ? selectOnPointerUp : void 0,
      onCompositionStart: () => {
        composingRef.current = true
      },
      onCompositionEnd: (e) => {
        composingRef.current = false
        if (e.currentTarget.value !== value) {
          setValue(e.currentTarget.value)
          props.onChange?.(e.currentTarget.value, setValue)
        }
      },
      onKeyDown:
        props.returnToCommit || props.onNavigate
          ? (e) => {
              if (!composingRef.current && (e.key === 'Enter' || e.key === 'Escape')) {
                if (e.key === 'Escape') {
                  e.currentTarget.value = props.value ?? ''
                }
                e.currentTarget.blur()
                if (e.key === 'Enter' && isFunction(props.returnToCommit)) {
                  props.returnToCommit(e.currentTarget)
                }
              }
              if (props.onNavigate) {
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  props.onNavigate(e.currentTarget, -1)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  props.onNavigate(e.currentTarget, 1)
                }
              }
            }
          : void 0,
      placeholder: props.placeholder,
      title: props.title,
      disabled: props.disabled,
      readOnly: props.readOnly,
      autoCorrect: 'off',
      autoCapitalize: 'off',
      spellCheck: 'false',
      autoFocus: props.autoFocus,
    }
    sharedProps['aria-label'] = props.ariaLabel
    sharedProps['aria-invalid'] = props.ariaInvalid

    const input = props.multiline ? <textarea ref={ref as React.Ref<HTMLTextAreaElement>} {...(sharedProps as any)} /> : <input ref={ref} {...sharedProps} />

    useEffect(() => {
      if (wrapperRef.current && props.onResize) {
        const inputElement = wrapperRef.current.firstElementChild as HTMLInputElement

        // ResizeObserver fires first callback immediately.
        // https://github.com/WICG/resize-observer/issues/38
        let skipFirst = true
        const observer = new ResizeObserver((entries) => {
          if (skipFirst) {
            skipFirst = false
            return
          }
          props.onResize?.(entries[0].borderBoxSize[0].blockSize)
        })

        const onPointerDown = () => {
          skipFirst = true
          observer.observe(inputElement)
          inputElement.addEventListener('pointerup', function onPointerUp() {
            observer.unobserve(inputElement)
            inputElement.removeEventListener('pointerup', onPointerUp)
          })
        }
        inputElement.addEventListener('pointerdown', onPointerDown)

        return () => {
          inputElement.removeEventListener('pointerdown', onPointerDown)
          observer.disconnect()
        }
      }
    }, [props.onResize])

    useEffect(() => {
      if (wrapperRef.current && props.onRealChange) {
        const inputElement = wrapperRef.current.firstElementChild as HTMLInputElement
        const handler = () => props.onRealChange?.(inputElement.value)
        inputElement?.addEventListener('change', handler)
        return () => inputElement?.removeEventListener('change', handler)
      }
    }, [props.onRealChange])

    const suffixCount = (props.suffix ? 1 : 0) + (props.isClearable ? 1 : 0)

    const element = (
      <div
        ref={wrapperRef}
        className={clsx(
          styles.wrapper,
          suffixCount === 2 && styles.twoSuffix,
          suffixCount === 1 && styles.oneSuffix,
          props.isSuffix && styles.isSuffix,
          props.className,
        )}
      >
        {input}
        {props.doubleClickToSelect && (
          <div
            className={styles.mask}
            title={props.title}
            onDoubleClick={() => {
              if (props.readOnly) return
              const inputElement = wrapperRef.current?.firstElementChild as HTMLInputElement
              inputElement?.focus()
              inputElement?.select()
            }}
          />
        )}
        {props.prefix && <div className={styles.prefix}>{props.prefix}</div>}
        {(props.suffix || props.isClearable) && (
          <div className={styles.suffix}>
            {props.isClearable && (
              <Button
                className={styles.clear}
                onClick={() => (props as InputProps<true>).onChange?.(null, setValue)}
                onMouseDown={stopEvent}
                size="icon-xs"
                tabIndex={-1}
                variant="ghost"
              >
                <i className="i-codicon:close" />
              </Button>
            )}
            {props.isClearable && props.suffix && <div className={styles.clearIndicator} />}
            {props.suffix}
          </div>
        )}
      </div>
    )

    return (
      <CanvasTooltip placement="top" title={props.warning}>
        {element}
      </CanvasTooltip>
    )
  })
