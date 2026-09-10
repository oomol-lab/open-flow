import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { generateScopedName } from '../../src/build/node/cssModules.ts'
import designerUnoConfig from '../../src/build/node/designerUnoConfig.ts'
import { providerIconsPlugin } from '../../src/build/node/providerIcons.ts'
import { twemojiCollectionPlugin } from '../../src/build/node/twemojiCollection.ts'
import { triggerDefinitions } from '../../src/trigger/providers/definitions.ts'

export default defineConfig({
  root: import.meta.dirname,
  css: { modules: { generateScopedName } },
  plugins: [
    {
      name: 'lab-trigger-snapshots',
      resolveId: (id) => (id === 'virtual:lab-trigger-snapshots' ? '\0virtual:lab-trigger-snapshots' : undefined),
      load: (id) =>
        id === '\0virtual:lab-trigger-snapshots' ? `export default ${JSON.stringify(triggerDefinitions.map(({ snapshot }) => snapshot))}` : undefined,
    },
    providerIconsPlugin({ iconUrls: {} }),
    twemojiCollectionPlugin(),
    tailwindcss(),
    UnoCSS({
      ...designerUnoConfig,
      content: {
        ...designerUnoConfig.content,
        filesystem: [path.resolve(import.meta.dirname, '**/*.{ts,tsx}')],
      },
      // Include the theme menu because its portal sits outside the Lab shell.
      postprocess: [
        (utility) => {
          utility.selector = `.lab-shell ${utility.selector}, .lab-theme-menu ${utility.selector}`
        },
      ],
    }),
    react(),
  ],
  resolve: { alias: { '@lab': path.resolve(import.meta.dirname) } },
  server: { open: false },
})
