// @vitest-environment happy-dom
import { toSvg } from 'html-to-image'
import { expect, it } from 'vitest'
import { captureStyleProperties } from './captureStyles.ts'

it('preserves resolved SVG capture styles on paths, gradients and arrow markers', async () => {
  const host = document.createElement('div')
  host.style.setProperty('--edge-tone', 'rgb(100, 110, 120)')
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="color"><stop style="stop-color:var(--edge-tone)" /></linearGradient>
      <marker id="arrow"><path style="stroke:var(--edge-tone);fill:none" d="M 0 0 L 5 5" /></marker>
    </defs>
    <path style="stroke:var(--edge-tone);fill:none;marker-end:url(#arrow)" d="M 0 0 L 50 50" />
  </svg>`
  document.body.append(host)
  try {
    // A previous capture's selected properties must not leak into this one.
    await toSvg(host, { skipFonts: true, includeStyleProperties: ['color'] })
    const dataUrl = await toSvg(host, { skipFonts: true, includeStyleProperties: captureStyleProperties(host) })
    const snapshot = new DOMParser().parseFromString(decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1)), 'image/svg+xml')
    const paths = [...snapshot.querySelectorAll('path')]
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.style.stroke).toBe('rgb(100, 110, 120)')
      expect(path.style.fill).toBe('none')
      expect(path.style.getPropertyValue('--edge-tone')).toBe('')
    }
    expect(snapshot.querySelector('stop')!.style.stopColor).toBe('rgb(100, 110, 120)')
    expect(snapshot.querySelector<SVGPathElement>('svg > path')!.style.markerEnd).toContain('#arrow')
  } finally {
    host.remove()
  }
})
