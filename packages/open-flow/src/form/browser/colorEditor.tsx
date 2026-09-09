import type { ValueEditorProps } from './valueEditor.tsx'

import { useEffect, useRef, useState } from 'react'
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful'
import tinycolor from 'tinycolor2'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { objectValue } from '../common/value.ts'

interface ScreenColorPicker {
  open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }>
}

export function ColorEditor({ value, schema, label, disabled, onChange, path, onDraftIssue }: ValueEditorProps) {
  const t = useTranslate()
  const picker = useRef<AbortController>()
  const mode = objectValue(objectValue(schema)?.['ui:options'])?.colorType
  const alpha = mode === 'HEX8'
  const lastValue = useRef(value)
  const [text, setText] = useState(typeof value === 'string' ? value : '')
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(typeof value === 'string' ? value : '')
  }, [value])
  const color = tinycolor(text)
  const valid = color.isValid()
  const [screenError, setScreenError] = useState(false)
  const ScreenPicker = (globalThis as typeof globalThis & { EyeDropper?: new () => ScreenColorPicker }).EyeDropper
  useEffect(() => {
    onDraftIssue(path, text !== '' && !valid)
    return () => onDraftIssue(path, false)
  }, [text, valid, path, onDraftIssue])
  useEffect(() => () => picker.current?.abort(), [])
  useEffect(() => {
    if (disabled) picker.current?.abort()
  }, [disabled])
  const commit = (next: string) => {
    const parsed = tinycolor(next)
    if (parsed.isValid()) {
      const nextValue = (alpha ? parsed.toHex8String() : parsed.toHexString()).toUpperCase()
      lastValue.current = nextValue
      setText(nextValue)
      onDraftIssue(path, false)
      onChange(nextValue)
    }
  }
  const channels = mode === 'RGB' ? color.toRgb() : color.toHsv()
  const channelNames = mode === 'RGB' ? (['r', 'g', 'b'] as const) : (['h', 's', 'v'] as const)
  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label={label}
        aria-invalid={text !== '' && !valid}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const invalid = next !== '' && !tinycolor(next).isValid()
          onDraftIssue(path, invalid)
          if (!invalid) {
            lastValue.current = next === '' ? undefined : next
            onChange(lastValue.current)
          }
        }}
      />
      {text !== '' && !valid && (
        <p className="text-sm text-destructive" role="alert">
          {t('valueEditor.invalidColor')}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">{t('valueEditor.chooseColor')}</summary>
        <fieldset disabled={disabled} className="mt-2 flex flex-col gap-2 border-0 p-0">
          <div className={disabled ? 'pointer-events-none opacity-50' : undefined} ref={(element) => element?.toggleAttribute('inert', disabled === true)}>
            {alpha ? (
              <HexAlphaColorPicker color={valid ? color.toHex8String() : '#7d7fe9ff'} onChange={commit} />
            ) : (
              <HexColorPicker color={valid ? color.toHexString() : '#7d7fe9'} onChange={commit} />
            )}
          </div>
          {(mode === 'RGB' || mode === 'HSV') &&
            channelNames.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                {channel.toUpperCase()}
                <Input
                  type="range"
                  aria-label={`${label} ${channel.toUpperCase()}`}
                  min={0}
                  max={mode === 'RGB' ? 255 : channel === 'h' ? 359 : 1}
                  step={mode === 'HSV' && channel !== 'h' ? 0.01 : 1}
                  value={(channels as unknown as Record<string, number>)[channel]}
                  onChange={(event) => commit(tinycolor({ ...channels, [channel]: Number(event.target.value) }).toHexString())}
                />
              </label>
            ))}
          {ScreenPicker && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                picker.current?.abort()
                const controller = new AbortController()
                picker.current = controller
                setScreenError(false)
                try {
                  const result = await new ScreenPicker().open({ signal: controller.signal })
                  if (!controller.signal.aborted) commit(result.sRGBHex)
                } catch (error) {
                  if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setScreenError(true)
                }
              }}
            >
              {t('valueEditor.pickColorFromScreen')}
            </Button>
          )}
          {screenError && <p role="alert">{t('valueEditor.colorPickerError')}</p>}
        </fieldset>
      </details>
    </div>
  )
}
