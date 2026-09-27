import type { ReactElement } from 'react'
import type { ControlClient, ResultInfo, ResultPage } from '../../../../control/common/api.ts'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { JsonValueView } from './runOutput.tsx'

export type RunResultsClient = Pick<ControlClient, 'readRunResult' | 'downloadRunResult'>

export function RunResults({
  client,
  runId,
  results,
}: {
  readonly client: RunResultsClient
  readonly results: readonly ResultInfo[]
  readonly runId: string
}): ReactElement | null {
  const t = useTranslate()
  const contentId = useId()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const request = useRef<AbortController>()
  const [selection, setSelection] = useState<{ readonly resultId: string; readonly page: ResultPage }>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => () => request.current?.abort(), [])

  async function load(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    try {
      await operation(controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function read(result: ResultInfo, pointer = '', offset = 0): void {
    void load(async (signal) => {
      const value = await client.readRunResult(runId, result.resultId, { pointer, offset }, signal)
      if (signal.aborted) return
      setSelection({ resultId: result.resultId, page: value.page })
    })
  }
  function download(result: ResultInfo): void {
    void load(async (signal) => {
      const blob = await client.downloadRunResult(runId, result.resultId, signal)
      if (signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${result.resultId}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }
  if (results.length == 0) return null
  return (
    <div ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            request.current?.abort()
            setBusy(false)
          }
        }}
      >
        <Tooltip>
          <DialogTrigger render={<Button render={<TooltipTrigger />} type="button" size="icon-xs" variant="ghost" aria-label={t('run.savedResults')} />}>
            <i aria-hidden="true" className="i-lucide-light:file-json" />
          </DialogTrigger>
          <TooltipContent container={root}>{t('run.savedResults')}</TooltipContent>
        </Tooltip>
        <DialogContent
          container={root}
          closeLabel={t('contextPanel.close')}
          className="flex min-h-[min(360px,80dvh)] max-h-[80dvh] flex-col overflow-hidden sm:max-w-3xl"
        >
          <DialogTitle className="pr-8">{t('run.savedResults')}</DialogTitle>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
            {error != null && <p role="alert">{error}</p>}
            {busy && <p role="status">{t('run.loadingResults')}</p>}
            {results.map((result) => {
              const page = selection?.resultId == result.resultId ? selection.page : undefined
              const expanded = page != null
              const label = result.source.kind == 'code' ? t('agent.code') : result.source.action
              return (
                <section className="rounded-md border border-border" key={result.resultId}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                    <div className="min-w-0 flex-1 break-words font-medium">{label}</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        disabled={busy}
                        aria-expanded={expanded}
                        aria-controls={expanded ? contentId : undefined}
                        onClick={() => (expanded ? setSelection(undefined) : read(result))}
                        size="xs"
                        variant="ghost"
                      >
                        {t(expanded ? 'run.collapseText' : 'run.viewResult')}
                      </Button>
                      <Button disabled={busy} onClick={() => download(result)} size="xs" variant="ghost">
                        {t('run.downloadResult')}
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <div id={contentId} className="flex flex-col gap-2 border-t border-border/50 p-3">
                      {page.pointer != '' && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Button disabled={busy} onClick={() => read(result)} size="xs" variant="ghost">
                            {t('run.resultRoot')}
                          </Button>
                          <Button disabled={busy} onClick={() => read(result, page.pointer.slice(0, page.pointer.lastIndexOf('/')))} size="xs" variant="ghost">
                            {t('run.resultParent')}
                          </Button>
                          <code className="break-all">{page.pointer}</code>
                        </div>
                      )}
                      {!page.complete && <p className="text-xs text-muted-foreground">{t('run.resultPartial')}</p>}
                      {page.value !== undefined && <JsonValueView label={label} value={page.value} />}
                      {page.entries?.map((entry) => (
                        <div className="flex flex-col gap-1" key={entry.pointer}>
                          <Button
                            className="max-w-full justify-start whitespace-normal break-all"
                            disabled={busy}
                            onClick={() => read(result, entry.pointer)}
                            size="xs"
                            variant="ghost"
                          >
                            {entry.pointer} · {entry.type}
                          </Button>
                          {entry.complete && entry.value !== undefined && <JsonValueView label={entry.pointer} value={entry.value} />}
                        </div>
                      ))}
                      {(page.offset > 0 || page.nextOffset != null) && (
                        <div className="flex flex-wrap gap-2">
                          {page.offset > 0 && (
                            <Button disabled={busy} onClick={() => read(result, page.pointer)} size="xs" variant="ghost">
                              {t('run.resultFirstPage')}
                            </Button>
                          )}
                          {page.nextOffset != null && (
                            <Button disabled={busy} onClick={() => read(result, page.pointer, page.nextOffset)} size="xs" variant="secondary">
                              {t('run.resultNextPage')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
