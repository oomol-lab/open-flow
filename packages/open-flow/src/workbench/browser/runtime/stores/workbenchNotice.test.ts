import { describe, expect, it } from 'vitest'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { ApiError } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { errorNotice } from './workbenchNotice.ts'

describe('Workbench notices', () => {
  it('explains when Connector has not been configured', () => {
    const i18n = createI18n('zh-CN')

    expect(errorNotice(new ApiError(503, 'connector.unconfigured', 'Connector is not configured for this deployment.'), i18n.t)).toEqual({
      kind: 'error',
      message: '当前部署尚未配置 Connector。',
    })
  })

  it('explains when a Connector Connection is required', () => {
    const i18n = createI18n('zh-CN')

    expect(
      errorNotice(new ApiError(409, 'connector.connection-required', 'The Connector Task requires a Connection before it can be published.'), i18n.t),
    ).toEqual({
      kind: 'error',
      message: '需要有效的 Connection。请连接或重新连接账号后重试。',
    })
  })

  it('localizes every Control API error code', () => {
    const i18n = createI18n('zh-CN')

    for (const code of Object.values(controlErrorCode)) {
      expect(errorNotice(new ApiError(400, code, 'Raw server message.'), i18n.t).message).not.toContain('Raw server message.')
    }
  })

  it('localizes client and network failures', () => {
    const i18n = createI18n('zh-CN')

    expect(errorNotice(new ApiError(502, 'response.invalid', 'The Control API returned an invalid response.'), i18n.t).message).toBe(
      'Control API 返回了无效响应。',
    )
    expect(errorNotice(new TypeError('Failed to fetch'), i18n.t).message).toBe('请求失败。')
  })

  it('preserves details for unknown error codes', () => {
    const i18n = createI18n('zh-CN')

    expect(errorNotice(new ApiError(500, 'deployment.custom', 'Custom deployment detail.'), i18n.t)).toEqual({
      kind: 'error',
      message: 'Custom deployment detail. (deployment.custom)',
    })
  })
})
