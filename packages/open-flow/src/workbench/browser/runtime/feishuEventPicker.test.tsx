import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { FeishuEventPicker } from './feishuEventPicker.tsx'
import { createI18n } from './i18n.ts'

it('shows localized event names and preserves custom selections without writing on render', () => {
  const onChange = vi.fn()
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <FeishuEventPicker value={['im.message.receive_v1', 'example.event_v1']} onChange={onChange} />
    </I18nProvider>,
  )
  expect(html).toContain('收到消息')
  expect(html).toContain('im.message.receive_v1')
  expect(html).toContain('example.event_v1')
  expect(html).toContain('添加自定义事件类型')
  expect(onChange).not.toHaveBeenCalled()
})

it('limits Flow choices to source events while showing stale selections for removal', () => {
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <FeishuEventPicker value={['drive.file.edit_v1']} allowedEvents={['im.message.receive_v1', 'example.event_v1']} onChange={() => {}} />
    </I18nProvider>,
  )
  expect(html).toContain('im.message.receive_v1')
  expect(html).toContain('example.event_v1')
  expect(html).toContain('drive.file.edit_v1')
  expect(html).toContain('This event is not allowed')
  expect(html).not.toContain('drive.file.deleted_v1')
  expect(html).not.toContain('Add custom event type')
})

it('disables selection, removal, search, and custom entry in read-only mode', () => {
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <FeishuEventPicker value={['im.message.receive_v1']} disabled onChange={() => {}} />
    </I18nProvider>,
  )
  const controls = html.match(/<(?:input|button)\b[^>]*>/g) ?? []
  expect(controls.length).toBeGreaterThan(0)
  expect(controls.every((control) => /\bdisabled(?:=|\s|>)/.test(control))).toBe(true)
})
