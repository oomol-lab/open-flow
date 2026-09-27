import type { Publication } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { RevisionCanvas } from '../editor/revisionCanvas.tsx'

type Snapshot = Awaited<ReturnType<WorkbenchStore['publicationSnapshot']>>

export function PublicationSnapshot({
  publication,
  store,
  theme,
}: {
  readonly publication: Publication
  readonly store: WorkbenchStore
  readonly theme: WorkbenchTheme
}) {
  const t = useTranslate()
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [failed, setFailed] = useState(false)
  const { flowId, publicationId, revisionId } = publication
  useEffect(() => {
    const controller = new AbortController()
    setSnapshot(undefined)
    setFailed(false)
    void store
      .publicationSnapshot({ flowId, publicationId, revisionId }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [flowId, publicationId, revisionId, store, attempt])
  if (failed)
    return (
      <div className="publication-empty" role="alert">
        <p>{t('snapshot.failed')}</p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          {t('empty.retry')}
        </Button>
      </div>
    )
  if (snapshot == null)
    return (
      <div className="publication-empty" role="status">
        {t('snapshot.loading')}
      </div>
    )
  return <RevisionCanvas draft={snapshot.draft} presentation={snapshot.presentation} theme={theme} interactiveMode$={store.interactiveMode$} />
}
