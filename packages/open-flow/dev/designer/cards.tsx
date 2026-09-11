import type { ReactNode } from 'react'
import type { FlowCanvasViewNodeRun } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useRef, useMemo } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { CanvasCard, TriggerIndicator } from '../../src/canvas/browser/graph/Nodes/components/CanvasCard.tsx'
import { RunChips } from '../../src/canvas/browser/graph/Nodes/components/RunChips.tsx'
import { GetPopupContainerContext } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { createI18n } from '../../src/canvas/browser/i18n/i18n-loader.ts'

const completed: FlowCanvasViewNodeRun = {
  status: 'success',
  runId: 'lab-run-042',
  startedAt: '2026-09-05T01:00:00Z',
  finishedAt: '2026-09-05T01:00:08.200Z',
  outputs: { customers: 128, qualified: 42 },
  logs: [{ time: '2026-09-05T01:00:06Z', level: 'info', message: '42 customers matched the criteria.' }],
}

function ReportPreview() {
  return (
    <svg viewBox="0 0 280 150" role="img" aria-label="Sample activity report" className="card-study-report">
      <rect width="280" height="150" rx="12" fill="var(--node-background-color)" />
      <text x="18" y="30" fill="var(--text-2)" fontSize="10" fontFamily="sans-serif">
        WEEKLY ACTIVITY
      </text>
      <text x="18" y="64" fill="var(--text-4)" fontSize="28" fontWeight="600" fontFamily="sans-serif">
        128
      </text>
      {[35, 58, 42, 73, 64, 90, 108].map((height, index) => (
        <rect
          key={index}
          x={24 + index * 35}
          y={134 - height * 0.55}
          width="20"
          height={height * 0.55}
          rx="4"
          fill={index == 6 ? 'var(--text-4)' : 'var(--fill-6)'}
        />
      ))}
    </svg>
  )
}

function CardStage({ dark, language, children }: { readonly dark: boolean; readonly language: UiLanguage; readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const i18n = useMemo(() => createI18n(language), [language])
  const popup = useMemo(() => ({ default: () => root.current ?? document.body, static: () => root.current ?? document.body }), [])
  return (
    <I18nProvider i18n={i18n}>
      <div ref={root} className={`open-flow-canvas-root open-flow-theme card-studies`} data-surface="canvas" data-theme={dark ? 'dark' : 'light'}>
        <GetPopupContainerContext.Provider value={popup}>{children}</GetPopupContainerContext.Provider>
      </div>
    </I18nProvider>
  )
}

export const cardStories: readonly FrontendStory[] = [
  {
    group: 'Canvas',
    id: 'canvas-card-indicators',
    title: 'Cards · Identity indicators',
    description: 'Warm trigger indicators and error replacements at normal and compact zoom, balanced with the leading icons.',
    standalone: true,
    render: (_log, dark, language) => (
      <CardStage dark={dark} language={language}>
        <div className="card-studies-grid">
          {[false, true].flatMap((compact) =>
            [
              { label: 'Trigger', indicator: true, problem: undefined },
              { label: 'Trigger error', indicator: true, problem: 'Review the configuration.' },
              { label: 'Task error', indicator: false, problem: 'Review the configuration.' },
            ].map((state) => (
              <CanvasCard
                key={`${compact}-${state.label}`}
                title={`${state.label} · ${compact ? 'Compact' : 'Normal'}`}
                subtitle="Identity indicators"
                icon={<i className="i-carbon:code" />}
                indicator={state.indicator ? <TriggerIndicator label="Trigger" /> : undefined}
                problem={state.problem}
                compact={compact}
              />
            )),
          )}
        </div>
      </CardStage>
    ),
  },
  {
    group: 'Canvas',
    id: 'canvas-card-states',
    title: 'Cards · Borders & shadows',
    standalone: true,
    render: (_log, dark, language) => (
      <CardStage dark={dark} language={language}>
        <div className="card-studies-grid">
          {([undefined, 'comment'] as const).flatMap((tone) =>
            [
              { label: 'Default', selected: false, problem: undefined },
              { label: 'Selected', selected: true, problem: undefined },
              { label: 'Error', selected: false, problem: 'Review the configuration.' },
              { label: 'Selected + error', selected: true, problem: 'Review the configuration.' },
            ].map((state) => (
              <CanvasCard
                key={`${tone}-${state.label}`}
                title={`${tone ?? 'Neutral'} · ${state.label}`}
                tone={tone}
                selected={state.selected}
                problem={state.problem}
              >
                Selection rings follow the border color. Shadows stay subtle and neutral.
              </CanvasCard>
            )),
          )}
        </div>
      </CardStage>
    ),
  },
  {
    group: 'Canvas',
    id: 'canvas-cards',
    description: 'Identity, plain text and framed previews. Empty content takes no space. Open results and logs from the status row.',
    title: 'Cards · Content & records',
    standalone: true,
    render: (_log, dark, language) => (
      <CardStage dark={dark} language={language}>
        <div className="card-studies-grid">
          <CanvasCard title="Receive an order" subtitle="Webhook" icon={<i className="i-carbon:webhook" />} />
          <CanvasCard title="Normalize order data" subtitle="JavaScript" icon={<i className="i-carbon:code" />} />
          <CanvasCard title="Check for updates" subtitle="Every 1 hour" icon={<i className="i-carbon:time" />} />
          <CanvasCard title="Campaign limits" subtitle="Values" icon={<i className="i-carbon:settings-adjust" />}>
            <p>
              Batch size: 50
              <br />
              Minimum score: 80
            </p>
          </CanvasCard>
          <CanvasCard title="Collect customer updates" subtitle="Schedule" icon={<i className="i-carbon:time" />}>
            <p>
              Every weekday at 09:00
              <br />
              Asia / Shanghai
            </p>
          </CanvasCard>
          <CanvasCard
            title="Find qualified customers"
            subtitle="Condition"
            icon={<i className="i-carbon:decision-tree" />}
            footer={<RunChips run={completed} />}
          >
            <p>
              Score ≥ 80
              <br />
              Company size ≥ 50
            </p>
          </CanvasCard>
          <CanvasCard
            title="Review the campaign"
            subtitle="Approval"
            icon={<i className="i-carbon:time" />}
            footer={<RunChips run={{ status: 'waiting', runId: completed.runId }} />}
          >
            <p>Waiting for the campaign owner to approve the message and audience.</p>
          </CanvasCard>
          <CanvasCard
            title="Create the weekly report"
            subtitle="JavaScript"
            icon={<i className="i-carbon:chart-column" />}
            footer={<RunChips run={completed} />}
            preview={<ReportPreview />}
          >
            <p>A summary of this week’s customer activity.</p>
          </CanvasCard>
          <CanvasCard
            title="Enrich company profiles"
            subtitle="Research"
            selected
            icon={<i className="i-carbon:search" />}
            footer={<RunChips run={{ status: 'running', progress: 42, runId: completed.runId, startedAt: completed.startedAt }} />}
          >
            <p>Gather company size, sector and recent announcements.</p>
          </CanvasCard>
          <CanvasCard
            title="Send the campaign"
            subtitle="Connector"
            problem="The account needs to be reconnected."
            icon={<i className="i-carbon:email" />}
            footer={
              <RunChips
                run={{ status: 'error', runId: completed.runId, error: { code: 'connector.connection-required', message: 'Reconnect the sending account.' } }}
              />
            }
          >
            <p>Send the approved campaign to the selected customers.</p>
          </CanvasCard>
        </div>
      </CardStage>
    ),
  },
]
