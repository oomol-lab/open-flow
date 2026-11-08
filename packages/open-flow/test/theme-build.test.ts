import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, it } from 'vitest'

it('keeps light and dark palette switching intact in production CSS', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      cssMinify: true,
      // Exercise the light-dark() fallback used by the production browser target.
      cssTarget: 'chrome107',
      rolldownOptions: { input: fileURLToPath(new URL('../src/ui/browser/theme.css', import.meta.url)) },
    },
  })
  if (!Array.isArray(result) && !('output' in result)) throw new Error('Expected a completed theme build, not a watcher.')
  const outputs = Array.isArray(result) ? result : [result]
  const css = outputs.flatMap((output) => output.output).find((output) => output.type == 'asset' && output.fileName.endsWith('.css'))
  expect(css?.type).toBe('asset')
  if (css?.type != 'asset') throw new Error('Missing compiled product theme.')
  const source = css.source.toString()
  const light = [...source.matchAll(/\.open-flow-theme\{([^}]+)\}/g)].map((match) => match[1]).find((rule) => rule?.includes('color-scheme:'))
  const dark = source.match(/\.open-flow-theme\[data-theme=(?:["']?)dark(?:["']?)\]\{([^}]+)\}/)?.[1]

  // Without these switches, both fallback colors concatenate into an invalid color.
  expect(light).toMatch(/--lightningcss-light:\s*initial\s*(?:;|$)/)
  expect(light).toMatch(/--lightningcss-dark:\s*(?:;|$)/)
  expect(dark).toMatch(/--lightningcss-light:\s*(?:;|$)/)
  expect(dark).toMatch(/--lightningcss-dark:\s*initial\s*(?:;|$)/)
})
