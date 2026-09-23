import type { PublishState } from './workspacePublishIsland.tsx'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WorkspacePublishIsland } from './workspacePublishIsland.tsx'

it.each<readonly [PublishState, string]>([
  ['ready', '可以发布：草稿有未发布的更改。'],
  ['current', '无需发布：当前草稿与线上版本一致。'],
  ['issues', '无法发布：草稿存在问题，请先修复。'],
  ['subflow', '无法发布：Subflow 会随工作流一起发布。'],
  ['busy', '无法发布：其他操作正在进行，请完成后再试。'],
  ['publishing', '无法发布：当前草稿正在发布中。'],
])('explains the %s publish state to assistive technology', (state, description) => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <WorkspacePublishIsland onOpenPublications={() => {}} onOpenRuns={() => {}} onPublish={() => {}} state={state} />
    </I18nProvider>,
  )

  expect(markup).toContain(`aria-description="${description}"`)
  expect(markup.includes('aria-disabled="true"')).toBe(state != 'ready')
})
