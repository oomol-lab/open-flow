import type { WorkbenchLocation } from '@oomol-lab/open-flow/workbench'

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return
  }
}

export function parseRoute(path: string): WorkbenchLocation {
  const [pathname = '/', search] = path.split('?')
  const source = new URLSearchParams(search).get('source')
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length == 0) return { view: 'design' }
  if (parts.length != 3 || parts[0] != 'flows') return { view: 'design' }
  const flowId = decode(parts[1]!)
  if (flowId == null) return { view: 'design' }
  switch (parts[2]) {
    case 'design':
    case 'publications':
    case 'runs':
      return { flowId, view: parts[2], ...(parts[2] == 'runs' && (source == 'draft' || source == 'live') ? { runSource: source } : {}) }
    default:
      return { view: 'design' }
  }
}

export function routePath(route: WorkbenchLocation): string {
  if (route.flowId == null) return '/'
  const search = route.view == 'runs' && route.runSource != null ? `?source=${route.runSource}` : ''
  return `/flows/${encodeURIComponent(route.flowId)}/${route.view}${search}`
}
