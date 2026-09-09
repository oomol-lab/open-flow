import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { TriggerSchedule } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { TriggerScheduleEditor } from '../../src/workbench/browser/runtime/editor/triggerScheduleEditor.tsx'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function ScheduleStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [schedules, setSchedules] = useState<readonly TriggerSchedule[]>([
    { type: 'every', unit: 'hour', value: 1 },
    { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 480 }}>
        <TriggerScheduleEditor
          schedules={schedules}
          disabled={false}
          testHint
          onChange={(next) => {
            setSchedules(next)
            log('Save schedule', next)
          }}
        />
        <output aria-label="Saved schedules">{JSON.stringify(schedules)}</output>
        <TriggerSummary trigger={{ kind: 'cron', name: 'Schedule', cronTimes: schedules }} />
        <TriggerSummary trigger={{ kind: 'manual', name: 'Manual' }} />
        <h3>Read only</h3>
        <TriggerScheduleEditor schedules={schedules} disabled onChange={() => log('Unexpected read-only save')} />
        <h3>Missing schedule</h3>
        <TriggerScheduleEditor schedules={[]} disabled={false} onChange={() => {}} />
      </div>
    </I18nProvider>
  )
}

export const scheduleStory: FrontendStory = {
  group: 'Workbench',
  id: 'trigger-schedule',
  title: 'Trigger Schedule',
  standalone: true,
  render: (log, dark, language) => <ScheduleStory dark={dark} language={language} log={log} />,
}
