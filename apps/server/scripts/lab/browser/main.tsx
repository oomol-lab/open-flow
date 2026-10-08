import 'virtual:uno.css'
import '@oomol-lab/open-flow/preview.css'
import './style.css'
import type { PreviewSnapshot } from '../preview.ts'

import { OpenFlowPreview } from '@oomol-lab/open-flow/preview'
import { IdTooltip } from '@oomol-lab/open-flow/ui'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>()
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    document.title = snapshot ? `${snapshot.name} · Open Flow CLI Lab` : 'Open Flow CLI Lab'
  }, [snapshot?.name])
  useEffect(() => {
    const events = new EventSource('/__lab/view')
    events.addEventListener('message', (event) => {
      setSnapshot(JSON.parse(event.data) as PreviewSnapshot)
      setConnected(true)
    })
    events.addEventListener('error', () => setConnected(false))
    return () => events.close()
  }, [])
  return (
    <main className="lab-page">
      <header className="lab-header server-host open-flow-theme" data-theme="light" ref={setHeader}>
        <div className="lab-summary">
          <div className="lab-heading">
            <h1>
              <img src="/open-flow-auto.svg" alt="" width={24} height={24} />
              Open Flow <span>CLI Lab</span>
            </h1>
            {snapshot && (
              <span className="lab-scenario">
                <span className="lab-separator" aria-hidden="true">
                  /
                </span>
                {snapshot.name}
              </span>
            )}
            <span className="lab-status" role="status">
              {connected ? '' : 'Reconnecting…'}
            </span>
          </div>
          <p>{snapshot?.task ?? 'Loading experiment…'}</p>
        </div>
        {snapshot && (
          <dl className="lab-identities">
            {(
              [
                ['Flow', snapshot.flowId],
                ['Revision', snapshot.draft.revisionId],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <IdTooltip
                    key={value}
                    value={value}
                    label={`${value.slice(0, 12)}...${value.slice(-6)}`}
                    trigger={<span tabIndex={0} className="lab-id" aria-label={`${label}: ${value}`} />}
                    container={header}
                    copyLabel={`Copy ${label} ID`}
                    copiedLabel="Copied"
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      <div className="lab-canvas">
        {snapshot && (
          <OpenFlowPreview
            key={snapshot.attemptId}
            draft={snapshot.draft}
            presentation={snapshot.presentation}
            language="en"
            theme="light"
            label="Experiment workflow"
          />
        )}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
