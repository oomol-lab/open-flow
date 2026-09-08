import { generateScopedName } from '@oomol-lab/open-flow/designer-css-modules'
import { twemojiCollectionPlugin } from '@oomol-lab/open-flow/designer-twemoji-plugin'
import designerUnoConfig from '@oomol-lab/open-flow/designer-vite-config'
import { providerIconsPlugin } from '@oomol-lab/open-flow/provider-icons-plugin'
import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serverPaths } from './node/transport/server-paths.ts'
import { developmentBackendPlugin } from './scripts/dev.ts'

const serverPathPattern = `^(?:${serverPaths.join('|')})(?:/|$)`

export default defineConfig(({ command }) => ({
  build: { outDir: 'dist/public' },
  css: { modules: { generateScopedName } },
  plugins: [
    command == 'serve' ? developmentBackendPlugin() : undefined,
    providerIconsPlugin(),
    twemojiCollectionPlugin(),
    tailwindcss(),
    UnoCSS(designerUnoConfig),
    react(),
  ],
  server: {
    proxy: { [serverPathPattern]: { target: process.env.OPEN_FLOW_DEV_API_ORIGIN ?? 'http://127.0.0.1:3001' } },
  },
  optimizeDeps: {
    entries: ['index.html', '../../packages/open-flow/src/workbench/browser/typeScriptWorker.ts'],
  },
}))
