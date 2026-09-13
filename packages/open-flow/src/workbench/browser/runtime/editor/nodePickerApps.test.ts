import { describe, expect, it } from 'vitest'
import { comparePickerApps } from './nodePickerApps.ts'

describe('picker app order', () => {
  it('prioritizes active connections before Chinese names and natural name order within each group', () => {
    const apps = [
      { label: 'App 10' },
      { label: '企业微信', connected: false },
      { label: 'Gmail', connected: true },
      { label: '17TRACK' },
      { label: '飞书', connected: true },
      { label: 'App 2', connected: false },
      { label: '钉钉' },
    ]
    expect(apps.toSorted(comparePickerApps).map((app) => app.label)).toEqual(['飞书', 'Gmail', '钉钉', '企业微信', '17TRACK', 'App 2', 'App 10'])
  })
})
