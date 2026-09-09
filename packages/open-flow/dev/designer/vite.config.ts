import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { generateScopedName } from '../../src/build/node/cssModules.ts'
import designerUnoConfig from '../../src/build/node/designerUnoConfig.ts'
import { providerIconsPlugin } from '../../src/build/node/providerIcons.ts'
import { twemojiCollectionPlugin } from '../../src/build/node/twemojiCollection.ts'

export default defineConfig({
  root: import.meta.dirname,
  css: { modules: { generateScopedName } },
  plugins: [providerIconsPlugin({ iconUrls: {} }), twemojiCollectionPlugin(), tailwindcss(), UnoCSS(designerUnoConfig), react()],
  resolve: { alias: { '@lab': path.resolve(import.meta.dirname) } },
  server: { open: false },
})
