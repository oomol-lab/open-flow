import type { FlowPngOptions, FlowPngResult } from '../../../../canvas/browser/graph/FlowCanvas/exportPng.ts'
import type { CanvasDirection } from '../../../../canvas/common/direction.ts'
import type { FlowPngAspectRatio, FlowPngLayout } from '../../../../render/common/png.ts'
import type { WorkbenchPreferences } from '../contract.ts'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { flowPngAspectRatios } from '../../../../render/common/png.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { Field, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../../../ui/browser/toggle-group.tsx'
import {
  readPngExportAspectRatio,
  readPngExportDark,
  readPngExportFrame,
  readPngExportLayout,
  writePngExportAspectRatio,
  writePngExportDark,
  writePngExportFrame,
  writePngExportLayout,
} from './pngExportPreference.ts'

export type PngExportSettings = Pick<FlowPngOptions, 'aspectRatio' | 'dark' | 'frame' | 'layout' | 'title'>

interface PreviewRequest {
  readonly render: (options: PngExportSettings) => Promise<FlowPngResult>
  readonly options: PngExportSettings
  readonly attempt: number
  readonly open: boolean
}

interface Preview {
  readonly request: PreviewRequest
  readonly result: FlowPngResult
  readonly url: string
}

export function PngExportDialog({
  container,
  defaultDark = false,
  direction,
  onDownload,
  onOpenChange,
  open,
  preferences,
  render,
  title,
}: {
  readonly container?: HTMLElement | null | undefined
  readonly defaultDark?: boolean
  readonly direction?: CanvasDirection | undefined
  readonly onDownload: (result: FlowPngResult) => Promise<boolean>
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly preferences?: WorkbenchPreferences | undefined
  readonly render: (options: PngExportSettings) => Promise<FlowPngResult>
  readonly title: string
}) {
  const t = useTranslate()
  const id = useId()
  const [aspectRatio, setAspectRatio] = useState(() => readPngExportAspectRatio(preferences))
  const [dark, setDark] = useState(() => readPngExportDark(preferences, defaultDark))
  const [frame, setFrame] = useState(() => readPngExportFrame(preferences))
  const [layout, setLayout] = useState(() => readPngExportLayout(preferences))
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<Preview>()
  const [failed, setFailed] = useState<PreviewRequest>()
  const [downloading, setDownloading] = useState(false)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const options = useMemo<PngExportSettings>(
    () => ({ aspectRatio, dark, frame, layout: direction === 'vertical' ? layout : 'original', title }),
    [aspectRatio, dark, frame, direction, layout, title],
  )
  // Reopening starts a fresh snapshot, even when export settings have not changed.
  const request = useMemo(() => ({ render, options, attempt, open }), [render, options, attempt, open])
  const ready = preview?.request === request
  const error = failed === request

  useEffect(() => {
    if (!open || ready) return
    let active = true
    setFailed(undefined)
    const timer = setTimeout(() => {
      // Coalesce quick changes and keep only one off-screen canvas alive at a time.
      queue.current = queue.current.then(async () => {
        if (!active) return
        try {
          const result = await request.render(request.options)
          if (active) setPreview({ request, result, url: URL.createObjectURL(result.blob) })
        } catch {
          if (active) setFailed(request)
        }
      })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, request, ready])

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container}
        closeLabel={t('common.close')}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>{t('resource.exportPng')}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto md:grid-cols-[minmax(0,1fr)_16rem]">
          <div
            aria-label={t('resource.exportPngPreview')}
            aria-busy={!ready && !error}
            className="grid h-[min(56dvh,32rem)] min-h-52 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center overflow-hidden rounded-lg border border-border p-2"
            style={{
              backgroundColor: 'var(--ui-background)',
              backgroundImage: 'conic-gradient(var(--ui-muted) 25%, transparent 0 50%, var(--ui-muted) 0 75%, transparent 0)',
              backgroundSize: '20px 20px',
            }}
            role="region"
          >
            {preview && (
              <img
                alt={title}
                className={`col-start-1 row-start-1 h-full max-h-full w-full min-h-0 min-w-0 object-contain ${ready ? '' : 'opacity-30'}`}
                src={preview.url}
              />
            )}
            {!ready && !error && (
              <div className="col-start-1 row-start-1 flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner aria-hidden="true" />
                {t('resource.exportPngPreviewPending')}
              </div>
            )}
            {error && (
              <div className="col-start-1 row-start-1 flex flex-col items-center gap-3 text-center">
                <p className="m-0 text-sm text-muted-foreground" role="alert">
                  {t('resource.exportPngPreviewFailed')}
                </p>
                <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                  {t('resource.exportPngPreviewRetry')}
                </Button>
              </div>
            )}
          </div>
          <FieldGroup className="self-start">
            <Field>
              <FieldLabel id={`${id}-ratio`}>{t('resource.exportPngAspectRatio')}</FieldLabel>
              <ToggleGroup
                aria-labelledby={`${id}-ratio`}
                className="grid w-full grid-cols-3"
                value={[aspectRatio]}
                variant="outline"
                onValueChange={(values) => {
                  const value = values[0] as FlowPngAspectRatio | undefined
                  if (!value) return
                  setAspectRatio(value)
                  writePngExportAspectRatio(preferences, value)
                }}
              >
                {flowPngAspectRatios.map((value) => (
                  <ToggleGroupItem key={value} value={value}>
                    {value === 'auto' ? t('resource.exportPngAuto') : value}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            {direction === 'vertical' && (
              <Field>
                <FieldLabel id={`${id}-layout`}>{t('resource.exportPngLayout')}</FieldLabel>
                <ToggleGroup
                  aria-labelledby={`${id}-layout`}
                  className="grid w-full grid-cols-2"
                  value={[layout]}
                  variant="outline"
                  onValueChange={(values) => {
                    const value = values[0] as FlowPngLayout | undefined
                    if (!value) return
                    setLayout(value)
                    writePngExportLayout(preferences, value)
                  }}
                >
                  <ToggleGroupItem value="original">{t('resource.exportPngOriginal')}</ToggleGroupItem>
                  <ToggleGroupItem value="compact">{t('resource.exportPngCompact')}</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            )}
            <Field>
              <FieldLabel id={`${id}-theme`}>{t('resource.exportPngTheme')}</FieldLabel>
              <ToggleGroup
                aria-labelledby={`${id}-theme`}
                className="grid w-full grid-cols-2"
                value={[dark ? 'dark' : 'light']}
                variant="outline"
                onValueChange={(values) => {
                  if (!values[0]) return
                  const value = values[0] === 'dark'
                  setDark(value)
                  writePngExportDark(preferences, value)
                }}
              >
                <ToggleGroupItem value="light">{t('resource.exportPngLight')}</ToggleGroupItem>
                <ToggleGroupItem value="dark">{t('resource.exportPngDark')}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-frame`}
                checked={frame}
                onCheckedChange={(value) => {
                  setFrame(value)
                  writePngExportFrame(preferences, value)
                }}
              />
              <FieldLabel htmlFor={`${id}-frame`}>{t('resource.exportPngFrame')}</FieldLabel>
            </Field>
            {ready && preview.result.hasImagePlaceholders && <p className="m-0 text-xs text-muted-foreground">{t('resource.exportPngPreviewPartial')}</p>}
          </FieldGroup>
        </div>
        <DialogFooter className="items-center">
          <output aria-live="polite" className="mr-auto text-xs tabular-nums text-muted-foreground">
            {ready && `${preview.result.width} × ${preview.result.height} px`}
          </output>
          <DialogClose render={<Button variant="outline" />}>{t('common.close')}</DialogClose>
          <Button
            disabled={!ready || downloading}
            aria-busy={downloading}
            onClick={async () => {
              if (!ready) return
              setDownloading(true)
              try {
                if (await onDownload(preview.result)) onOpenChange(false)
              } finally {
                setDownloading(false)
              }
            }}
          >
            {t('resource.exportPngDownload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
