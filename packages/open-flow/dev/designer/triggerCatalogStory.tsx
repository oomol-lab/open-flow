import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { LogAction } from './stories.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import snapshots from 'virtual:lab-trigger-snapshots'
import { localizeTrigger } from '../../src/trigger/providers/localization.ts'
import { BlockLibrary } from '../../src/workbench/browser/runtime/editor/contextPanel.tsx'
import { browserTriggerCatalogStorage } from '../../src/workbench/browser/runtime/stores/triggerCatalog.ts'
import { useStoryActions } from './storyActions.tsx'
import { triggerFixtures } from './triggerFixtures.ts'
import { createTriggerSession } from './triggerSession.ts'

function Sample({
  language,
  mode,
  log,
  register,
}: {
  language: UiLanguage
  mode: 'ready' | 'pending' | 'failed'
  log: LogAction
  register: (finish: () => void) => () => void
}) {
  const [ready, setReady] = useState(false)
  const pending = useRef<(() => void) | undefined>(undefined)
  const session = useMemo(() => {
    const data = async (count: number) => {
      const definitions = snapshots.slice(0, count)
      return {
        version: 1,
        locale: language,
        definitions,
        display: Object.fromEntries(await Promise.all(definitions.map(async (definition) => [definition.key, await localizeTrigger(definition, language)]))),
      }
    }
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const sampleSession = createTriggerSession(triggerFixtures[0]!.trigger, language, log, 'sample', false, {
      cache: { namespace: 'lab', storage },
      request: async (_url, init) => {
        log('catalog.request', { language, etag: new Headers(init?.headers).get('if-none-match') })
        if (mode == 'failed') return Response.json({ error: { code: 'request.failed', message: 'Sample offline response.' } }, { status: 503 })
        if (mode == 'ready') return new Response(null, { status: 304 })
        return new Promise<Response>((resolve, reject) => {
          pending.current = () => {
            void data(20).then((value) => resolve(Response.json(value, { headers: { etag: '"fresh"' } })), reject)
          }
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
        })
      },
    })
    return {
      ...sampleSession,
      prepare: async () => {
        browserTriggerCatalogStorage('lab', storage).setItem(language, JSON.stringify({ data: await data(mode == 'ready' ? 20 : 4), etag: '"cached"' }))
      },
    }
  }, [language, mode, log])
  const state = useVal(session.triggers.catalog.state)
  useEffect(() => register(() => pending.current?.()), [register])
  useEffect(() => {
    let active = true
    setReady(false)
    void session.prepare().then(async () => {
      if (!active) return
      await session.start()
      if (active) setReady(true)
    })
    return () => {
      active = false
      session.dispose()
    }
  }, [session])
  return (
    <I18nProvider i18n={session.i18n}>
      <section className="min-w-0 rounded-lg border border-[var(--ui-border)] p-3">
        <h3 className="mb-3">
          {language} · {mode === 'ready' ? 'Cached · 304' : mode === 'pending' ? 'Cached · refresh pending' : 'Cached · refresh failed'}
        </h3>
        {ready && (
          <BlockLibrary
            catalogRevision={state.revision}
            catalogFailed={state.failed}
            refreshCatalog={session.triggers.catalog.retry}
            browseOptions={session.triggers.browseAddNodeOptions}
            searchOptions={session.triggers.provideAddNodeOptions}
            disabled={false}
            focusRequest={0}
            onAdd={async (option) => {
              log('catalog.selected', option)
              return undefined
            }}
            options={[]}
            provideChoices={async () => []}
          />
        )}
      </section>
    </I18nProvider>
  )
}

export function TriggerCatalogStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const finishes = useRef(new Set<() => void>())
  const register = useMemo(
    () => (finish: () => void) => {
      finishes.current.add(finish)
      return () => {
        finishes.current.delete(finish)
      }
    },
    [],
  )
  const [reset, setReset] = useState(0)
  useStoryActions([
    { label: 'Complete refresh', onClick: () => finishes.current.forEach((finish) => finish()) },
    { label: 'Reset samples', onClick: () => setReset((value) => value + 1) },
  ])
  return (
    <div className="open-flow-workbench open-flow-theme grid grid-cols-3 gap-4 p-4" data-theme={dark ? 'dark' : 'light'} key={reset}>
      <Sample language="en" mode="ready" log={log} register={register} />
      <Sample language={language === 'en' ? 'zh-CN' : language} mode="pending" log={log} register={register} />
      <Sample language="fr" mode="failed" log={log} register={register} />
    </div>
  )
}
