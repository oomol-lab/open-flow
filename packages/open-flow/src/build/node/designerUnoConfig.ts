import type { IconifyJSON } from '@iconify/types'

import { presetIcons } from '@unocss/preset-icons'
import { defineConfig } from '@unocss/vite'
import { glob, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileIcons } from './fileIcons.ts'

const sourceRoot = path.resolve(import.meta.dirname, '../../..')

async function readBrowserSources(): Promise<{ code: string; id: string }> {
  const files: string[] = []
  for await (const file of glob('src/{canvas,form,ui,workbench}/browser/**/*.{ts,tsx}', { cwd: sourceRoot })) files.push(file)
  files.sort()
  const sources = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), 'utf8')))
  return { code: sources.join('\n'), id: 'open-flow-browser-sources.tsx' }
}

export default defineConfig({
  content: {
    inline: [readBrowserSources],
  },
  postprocess: [
    (utility) => {
      utility.selector = `:where(.open-flow-workbench, .open-flow-canvas-root, .open-flow-notifications) ${utility.selector}`
    },
  ],
  presets: [
    presetIcons({
      warn: true,
      collectionsNodeResolvePath: sourceRoot,
      collections: {
        'lucide-light': async () => {
          const collection: IconifyJSON = JSON.parse(await readFile(path.join(sourceRoot, 'node_modules/@iconify/json/json/lucide.json'), 'utf8'))
          return {
            ...collection,
            prefix: 'lucide-light',
            icons: Object.fromEntries(
              Object.entries(collection.icons).map(([name, icon]) => [name, { ...icon, body: icon.body.replaceAll('stroke-width="2"', 'stroke-width="1.5"') }]),
            ),
          }
        },
        'file': fileIcons,
        'custom': {
          mouse: `<svg viewBox="0 0 16 22" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.5 3V3.5C6.5 4.05228 6.94772 4.5 7.5 4.5V5H7C4.79086 5 3 6.79086 3 9V15C3 17.2091 4.79086 19 7 19H9C11.2091 19 13 17.2091 13 15V9C13 6.79086 11.2091 5 9 5H8.5V4.5C8.5 3.94772 8.05228 3.5 7.5 3.5V3H6.5ZM8.5 12V8H7.5V12H8.5ZM7 6H9C10.6569 6 12 7.34315 12 9V15C12 16.6569 10.6569 18 9 18H7C5.34315 18 4 16.6569 4 15V9C4 7.34315 5.34315 6 7 6Z" fill="currentColor"/></svg>`,
          touchpad: `<svg viewBox="0 0 22 22" fill="none"><path d="M13 13.5H9V14.5H13V13.5Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M4 7C4 5.89543 4.89543 5 6 5H16C17.1046 5 18 5.89543 18 7V15C18 16.1046 17.1046 17 16 17H6C4.89543 17 4 16.1046 4 15V7ZM6 6H16C16.5523 6 17 6.44772 17 7V15C17 15.5523 16.5523 16 16 16H6C5.44772 16 5 15.5523 5 15V7C5 6.44772 5.44772 6 6 6Z" fill="currentColor"/></svg>`,
          screen: `<svg viewBox="0 0 20 18" fill="none"><rect x="3" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-linejoin="bevel"/><path d="M5.98661 9.53347L8.11994 11.6668L7.42661 12.3601L4.43994 9.37347V8.68014L7.42661 5.64014L8.11994 6.3868L5.98661 8.52014H14.0133L11.8799 6.3868L12.5733 5.64014L15.5599 8.68014V9.37347L12.5733 12.3601L11.8799 11.6668L14.0133 9.53347H5.98661Z" fill="currentColor"/></svg>`,
          layout: `<svg viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 3.5L3.5 4V11L4 11.5H9L9.5 11V4L9 3.5H4ZM4.5 10.5V4.5H8.5V10.5H4.5ZM11 8.5L10.5 9V16L11 16.5H16L16.5 16V9L16 8.5H11ZM11.5 9.5H15.5V15.5H11.5V9.5ZM3.5 13L4 12.5H9L9.5 13V16L9 16.5H4L3.5 16V13ZM4.5 13.5V15.5H8.5V13.5H4.5ZM11 3.5L10.5 4V7L11 7.5H16L16.5 7V4L16 3.5H11ZM11.5 6.5V4.5H15.5V6.5H11.5Z" fill="currentColor"/></svg>`,
          maximize: `<svg viewBox="0 0 22 22" fill="none"><path fill="currentColor" fill-rule="evenodd" d="m5.5 5-.5.5v4.4h1V6h3.9V5H5.5Zm.5 7.1V16h3.9v1H5.5l-.5-.5v-4.4h1ZM16 16v-3.9h1v4.4l-.5.5h-4.4v-1H16ZM12.1 6H16v3.9h1V5.5l-.5-.5h-4.4v1Z" clip-rule="evenodd"/></svg>`,
          restore: `<svg viewBox="0 0 22 22" fill="none"><path fill="currentColor" fill-rule="evenodd" d="m8.6 9.1.5-.5V5h-1v3.1H5v1h3.6ZM8.1 17v-3.1H5v-1h3.6l.5.5V17h-1Zm5.8-3.1V17h-1v-3.6l.5-.5H17v1h-3.1ZM17 8.1h-3.1V5h-1v3.6l.5.5H17v-1Z" clip-rule="evenodd"/></svg>`,
          minimap: `<svg viewBox="0 0 22 22" fill="none"><path stroke="currentColor" stroke-linejoin="bevel" d="m8.75 5.375-4.5 2.813v8.437l4.5-2.813m0-8.437v8.438m0-8.438 4.5 2.813m-4.5 5.624 4.5 2.813m0 0V8.187m0 8.438 4.5-2.813V5.376l-4.5 2.813"/></svg>`,
        },
      },
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
        'user-select': 'none',
        'cursor': 'inherit',
      },
    }),
  ],
})
