import type { ReactElement } from 'react'
import type { ControlClient, ResultInfo, ResultPage } from '../../../../control/common/api.ts'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'

export function RunResults({
  client,
  runId,
}: {
  readonly client: Pick<ControlClient, 'listRunResults' | 'readRunResult' | 'downloadRunResult'>
  readonly runId: string
}): ReactElement {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  const request = useRef<AbortController>()
  const [results, setResults] = useState<readonly ResultInfo[]>([])
  const [next, setNext] = useState<string>()
  const [selected, setSelected] = useState<ResultInfo>()
  const [page, setPage] = useState<ResultPage>()
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
  function list(after?: string): void {
    void load(async (signal) => {
      const value = await client.listRunResults(runId, after, signal)
      if (signal.aborted) return
      setResults((current) => (after == null ? value.results : [...current, ...value.results]))
      setNext(value.nextAfter)
    })
  }
  function read(result: ResultInfo, pointer = '', offset = 0): void {
    void load(async (signal) => {
      const value = await client.readRunResult(runId, result.resultId, { pointer, offset }, signal)
      if (signal.aborted) return
      setSelected(result)
      setPage(value.page)
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
  return (
    <div ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (value) list()
          else {
            request.current?.abort()
            setBusy(false)
          }
        }}
      >
        <DialogTrigger render={<Button type="button" size="sm" variant="ghost" />}>{t('run.savedResults')}</DialogTrigger>
        <DialogContent container={root} closeLabel={t('contextPanel.close')} className="flex max-h-[80dvh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogTitle>{t('run.savedResults')}</DialogTitle>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto text-sm">
            <div>
              <Button disabled={busy} onClick={() => list()} size="sm" variant="ghost">
                {t('run.refreshResults')}
              </Button>
            </div>
            {error != null && <p role="alert">{error}</p>}
            {busy && <p role="status">{t('run.loadingResults')}</p>}
            {!busy && results.length == 0 && error == null && <p>{t('run.noResults')}</p>}
            {results.map((result) => (
              <div className="flex flex-wrap items-center gap-2 border-b py-1" key={result.resultId}>
                <span className="min-w-0 flex-1 break-all">
                  {result.source.kind == 'code' ? t('agent.code') : result.source.action} · {(result.bytes / 1024).toFixed(1)} KiB
                </span>
                <Button disabled={busy} onClick={() => read(result)} size="sm" variant="secondary">
                  {t('run.viewResult')}
                </Button>
                <Button disabled={busy} onClick={() => download(result)} size="sm" variant="ghost">
                  {t('run.downloadResult')}
                </Button>
              </div>
            ))}
            {next != null && (
              <Button disabled={busy} onClick={() => list(next)} size="sm" variant="ghost">
                {t('run.moreResults')}
              </Button>
            )}
            {selected != null && page != null && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy} onClick={() => read(selected)} size="sm" variant="ghost">
                    {t('run.resultRoot')}
                  </Button>
                  {page.pointer != '' && (
                    <Button disabled={busy} onClick={() => read(selected, page.pointer.slice(0, page.pointer.lastIndexOf('/')))} size="sm" variant="ghost">
                      {t('run.resultParent')}
                    </Button>
                  )}
                  <code className="break-all">
                    {page.pointer || '/'} · {page.type}
                  </code>
                </div>
                {!page.complete && <p>{t('run.resultPartial')}</p>}
                {Object.hasOwn(page, 'value') && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(page.value, null, 2)}</pre>
                )}
                {page.entries?.map((entry) => (
                  <div className="border-b py-1" key={entry.pointer}>
                    <Button disabled={busy} onClick={() => read(selected, entry.pointer)} size="sm" variant="ghost">
                      {entry.pointer} · {entry.type}
                    </Button>
                    {entry.complete && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(entry.value, null, 2)}</pre>}
                  </div>
                ))}
                <div className="flex gap-2">
                  {page.offset > 0 && (
                    <Button disabled={busy} onClick={() => read(selected, page.pointer)} size="sm" variant="ghost">
                      {t('run.resultFirstPage')}
                    </Button>
                  )}
                  {page.nextOffset != null && (
                    <Button disabled={busy} onClick={() => read(selected, page.pointer, page.nextOffset)} size="sm" variant="secondary">
                      {t('run.resultNextPage')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
