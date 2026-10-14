import { expect, it } from 'vitest'
import { waitActionPage } from '../node/transport/wait-action-page.ts'

it('escapes request content and offers only continue for ordinary waits', async () => {
  const page = await waitActionPage('/v1/wait-actions/token/continue', 'en', 200, {
    state: 'waiting',
    action: 'continue',
    prompt: '<script>alert(1)</script> & details',
    expiresAt: '2030-01-01T00:00:00.000Z',
  })
  const body = await page.text()
  expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; details')
  expect(body).not.toContain('<script>')
  expect(body).toContain('>Continue</button>')
  expect(body).not.toContain('>Approve</button>')
  expect(body).not.toContain('>Reject</button>')
  expect(page.headers.get('content-security-policy')).toContain("form-action 'self'")
})

it.each([400, 404, 429])('renders an actionable %s response without decision buttons', async (status) => {
  const page = await waitActionPage('/v1/wait-actions/token/approve', 'zh-CN', status)
  const body = await page.text()
  expect(page.status).toBe(status)
  expect(body).not.toContain('<form')
  expect(body).toContain(status == 404 ? '此链接不可用或已过期' : '返回请求')
})
