import { createGenerator } from '@unocss/core'
import { glob, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import unoConfig from '../../src/build/node/designerUnoConfig.ts'

const sourcePattern = 'src/**/*.{vue,svelte,ts,tsx,js,jsx,md,mdx,astro,elm,php,phtml,marko,html}'
const generatedSourcePatterns = ['src/build/node/fileIcons.ts']
const iconTokenPattern = /^(?:[a-z\d_-]+:)*i-[a-z\d_][a-z\d_:-]*[a-z\d_]$/i

describe('Designer icon CSS', () => {
  it('generates lighter Lucide strokes without changing the standard collection', async () => {
    const uno = await createGenerator(unoConfig)
    const light = await uno.generate('i-lucide-light:scan')
    const standard = await uno.generate('i-lucide:scan')

    expect(light.css).toContain("stroke-width='1.5'")
    expect(standard.css).toContain("stroke-width='2'")
  })

  it('resolves every statically scanned Iconify token', async () => {
    const uno = await createGenerator(unoConfig)
    const candidates = new Set<string>()

    const paths: string[] = []
    for await (const path of glob(sourcePattern, { exclude: generatedSourcePatterns })) paths.push(path)
    await Promise.all(
      paths.map(async (path) => {
        const source = await readFile(path, 'utf8')
        await uno.applyExtractors(source, path, candidates)
      }),
    )

    const iconTokens = new Set([...candidates].filter((candidate) => iconTokenPattern.test(candidate)))

    const generated = await uno.generate(iconTokens)
    const unresolved = [...iconTokens].filter((token) => !generated.matched.has(token))

    expect(unresolved).toEqual([])
  })
})
