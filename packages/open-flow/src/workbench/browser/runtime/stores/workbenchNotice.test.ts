import { describe, expect, it } from 'vitest'
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
})
