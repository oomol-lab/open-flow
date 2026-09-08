import styles from './colorPicker.module.scss'
import type { Instance as Color } from 'tinycolor2'
import type { ColorType } from './constants.ts'

import { clsx } from 'clsx'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HexAlphaColorPicker } from 'react-colorful'
import tinycolor from 'tinycolor2'
import { useTranslate } from 'val-i18n-react'
import { stopEvent } from '../base/dom.ts'
import { noop } from '../base/trivial.ts'
import { Button } from './button.tsx'
import { Label } from './label.tsx'
import { Range } from './range.tsx'

declare const EyeDropper: {
  prototype: EyeDropper
  new (): EyeDropper
}

interface EyeDropper {
  open(options?: ColorSelectionOptions): Promise<ColorSelectionResult>
}

interface ColorSelectionOptions {
  signal?: AbortSignal
}

interface ColorSelectionResult {
  sRGBHex: string
}

export interface ColorPickerProps {
  type?: ColorType
  /** Omitting this callback hides the color-mode switch. */
  onTypeChange?: (type: ColorType) => void
  className?: string
  style?: React.CSSProperties
  /** Semi-controlled `input.value` which updates only while the input is clean. */
  value?: string
  isClearable?: boolean
  onChange?: (value: string | null) => void
  disabled?: boolean
  isSuffix?: boolean
}

function getNextType(type: ColorType | undefined): ColorType {
  switch (type) {
    case 'RGB':
      return 'HSV'
    case 'HSV':
      return 'HEX'
    case 'HEX':
      return 'HEX8'
    case 'HEX8':
      return 'RGB'
    default:
      return 'HEX'
  }
}

function stringify(color: string | Color, type?: ColorType): string {
  switch (type) {
    case 'RGB':
      return tinycolor(color).toRgbString()
    case 'HSV':
      return tinycolor(color).toHsvString()
    case 'HEX8':
      return tinycolor(color).toHex8String().toUpperCase()
    case 'HEX':
    default:
      return tinycolor(color).toHexString().toUpperCase()
  }
}

const DEFAULT_COLOR = '#7d7fe9'
const DEFAULT_COLOR_INSTANCE = /*#__PURE__*/ tinycolor(DEFAULT_COLOR)

export function ColorPicker(props: ColorPickerProps): React.ReactElement {
  const t = useTranslate()
  const typeId = useId()
  const popoverId = useId()
  const dirtyRef = useRef(false)
  const [value, setValue] = useState(props.value ?? DEFAULT_COLOR)

  useLayoutEffect(() => {
    if (dirtyRef.current) {
      if (props.value === value) {
        dirtyRef.current = false
      }
    } else {
      setValue(props.value ?? DEFAULT_COLOR)
    }
  }, [props.value])

  const color = useMemo<Color | undefined>(() => {
    const instance = tinycolor(value)
    return instance.isValid() ? instance : undefined
  }, [value])

  useEffect(() => {
    if (color && props.onChange) {
      const newValue = stringify(color, props.type === 'HEX8' ? 'HEX8' : 'HEX')
      if (newValue !== props.value) {
        props.onChange?.(newValue)
      }
    }
  }, [color, props.onChange])

  // Keep rendering the last valid color while the text value is invalid.
  const lastColor = useRef<Color>(color || DEFAULT_COLOR_INSTANCE)
  if (color) lastColor.current = color

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [showPopover, setShowPopover] = useState(false)

  const onChange = useCallback((nextValue: string) => {
    dirtyRef.current = true
    setValue(nextValue)
  }, [])

  const onClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      stopEvent(ev, true)
      const next = !showPopover
      setShowPopover(next)
      if (next) {
        onChange(stringify(lastColor.current, props.type === 'HEX8' ? 'HEX8' : 'HEX'))
        setTimeout(() => {
          wrapperRef.current?.querySelector<HTMLDivElement>('.react-colorful__interactive')?.focus()
        })
      }
    },
    [color, showPopover, props.type],
  )

  const onKeydown = useCallback((ev: React.KeyboardEvent) => {
    const target = ev.target as HTMLElement
    if (ev.key === 'Escape' && target.tagName !== 'INPUT') {
      setShowPopover(false)
    }
  }, [])

  const onBlur = useCallback((ev: React.FocusEvent) => {
    const wrapper = wrapperRef.current
    if (wrapper && !wrapper.contains(ev.relatedTarget)) {
      setShowPopover(false)
    }
  }, [])

  function openEyeDropper() {
    new EyeDropper()
      .open()
      .then((result) => onChange(result.sRGBHex))
      .catch(noop)
  }

  function renderInputs(): React.ReactNode {
    const type = props.type === 'HEX8' ? 'HEX8' : 'HEX'
    if (props.type === 'RGB') {
      const rgb = lastColor.current.toRgb()
      const onRGBChange = (key: keyof typeof rgb) => (nextValue: number) => {
        const newColor = tinycolor({ ...rgb, [key]: nextValue })
        if (newColor.isValid()) {
          onChange(stringify(newColor, type))
        }
      }
      return (['r', 'g', 'b'] as const).map((key) => (
        <Range key={key} label={key.toUpperCase()} value={rgb[key]} min={0} max={255} step={1} onChange={onRGBChange(key)} />
      ))
    } else if (props.type === 'HSV') {
      const hsv = lastColor.current.toHsv()
      const onHSVChange = (key: keyof typeof hsv) => (nextValue: number) => {
        const newColor = tinycolor({ ...hsv, [key]: nextValue })
        if (newColor.isValid()) {
          onChange(stringify(newColor, type))
        }
      }
      return (['h', 's', 'v'] as const).map((key) => (
        <Range
          key={key}
          label={key.toUpperCase()}
          value={hsv[key]}
          min={0}
          max={key === 'h' ? 359 : 1}
          step={key === 'h' ? 1 : 0.01}
          onChange={onHSVChange(key)}
        />
      ))
    } else {
      return (
        <input
          aria-label={t('components.colorValue')}
          autoComplete="off"
          name="color-value"
          value={value.toUpperCase()}
          onChange={(ev) => onChange(ev.target.value)}
        />
      )
    }
  }

  return (
    <div ref={wrapperRef} className={clsx(styles.wrapper, props.isSuffix && styles.isSuffix)} style={props.style} onKeyDown={onKeydown}>
      <div className={styles.content}>
        <button
          aria-controls={showPopover ? popoverId : undefined}
          aria-expanded={showPopover}
          aria-label={t('components.chooseColor')}
          className={styles.swatch}
          style={{
            color: lastColor.current.toHexString(),
            ['--rgba' as any]: props.type === 'HEX8' ? lastColor.current.toHex8String() : lastColor.current.toHexString(),
          }}
          onClick={onClick}
          disabled={props.disabled}
          type="button"
        />
        {props.isClearable && (
          <button aria-label={t('components.clear')} className={styles.clear} onClick={() => props.onChange?.(null)} type="button">
            <i aria-hidden className="i-codicon:close" />
          </button>
        )}
      </div>
      {showPopover && (
        <div
          aria-label={t('components.chooseColor')}
          className={clsx(styles.popover, props.type === 'HEX8' && styles.enableAlpha)}
          id={popoverId}
          onBlur={onBlur}
          role="dialog"
          tabIndex={-1}
        >
          <HexAlphaColorPicker color={value} onChange={onChange} />
          <div className={styles.inputs}>
            <div className={styles.buttonGroup}>
              <Label htmlFor={typeId} wrapperClassName={styles.typeWrapper} className={styles.type}>
                {props.type || 'HEX'}
              </Label>
              {props.onTypeChange && (
                <Button
                  id={typeId}
                  wrapperClassName={styles.switchTypeWrapper}
                  className={styles.switchType}
                  onClick={() => props.onTypeChange?.(getNextType(props.type))}
                >
                  <i className="i-carbon:expand-categories" />
                </Button>
              )}
              {typeof EyeDropper != 'undefined' && (
                <button aria-label={t('components.pickColorFromScreen')} className={styles.eyeDropper} onClick={openEyeDropper} type="button">
                  <i aria-hidden className="i-carbon:eyedropper" />
                </button>
              )}
            </div>
            <div className={styles.inputWrapper}>{renderInputs()}</div>
          </div>
        </div>
      )}
    </div>
  )
}
