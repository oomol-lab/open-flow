import { generateScopedName } from '@oomol-lab/open-flow/designer-css-modules'
import { twemojiCollectionPlugin } from '@oomol-lab/open-flow/designer-twemoji-plugin'
import designerUnoConfig, { designerUnoScopes, scopeDesignerSelector } from '@oomol-lab/open-flow/designer-vite-config'
import { fullReloadPlugin } from '@oomol-lab/open-flow/full-reload-plugin'
import { providerIconsPlugin } from '@oomol-lab/open-flow/provider-icons-plugin'
import { triggerLocalesPlugin } from '@oomol-lab/open-flow/trigger-locales-plugin'
import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serverPaths } from './node/transport/server-paths.ts'
import { developmentBackendAgent, developmentBackendPlugin } from './scripts/dev.ts'

const serverPathPattern = `^(?:${serverPaths.join('|')})(?:/|$)`

export default defineConfig(({ command }) => ({
  build: { outDir: 'dist/public' },
  css: { modules: { generateScopedName } },
  plugins: [
    triggerLocalesPlugin(),
    command == 'serve' ? developmentBackendPlugin() : undefined,
    providerIconsPlugin(),
    twemojiCollectionPlugin(),
    tailwindcss(),
    UnoCSS({
      ...designerUnoConfig,
      postprocess: [
        (utility) => {
          utility.selector = scopeDesignerSelector(utility.selector, [...designerUnoScopes, '.server-host'])
        },
      ],
    }),
    react(),
    fullReloadPlugin(),
  ],
  server: {
    proxy: {
      [serverPathPattern]: { target: process.env.OPEN_FLOW_DEV_API_ORIGIN ?? 'http://127.0.0.1:3001', agent: developmentBackendAgent() },
    },
  },
  optimizeDeps: {
    entries: ['index.html', '../../packages/open-flow/src/workbench/browser/typeScriptWorker.ts'],
  },
}))
