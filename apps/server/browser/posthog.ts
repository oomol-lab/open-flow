import posthogClient from 'posthog-js'

// The public token belongs to the openflow.run project (607951).
const hosted = typeof location != 'undefined' && (location.hostname == 'openflow.run' || location.hostname == 'www.openflow.run')
const apiKey = import.meta.env.VITE_POSTHOG_KEY ?? (hosted ? 'phc_u8CbakAX3kxotvT6UY2ZZK7LFNURiYToJtc4cfKRWzQX' : '')
const apiHost = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com'
let posthog: typeof posthogClient | undefined

if (apiKey.length > 0 && apiHost.length > 0) {
  posthogClient.init(apiKey, {
    api_host: apiHost,
    ui_host: 'https://us.posthog.com',
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: 'history_change',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    defaults: '2026-05-30',
  })
  posthog = posthogClient
}

export { posthog }
