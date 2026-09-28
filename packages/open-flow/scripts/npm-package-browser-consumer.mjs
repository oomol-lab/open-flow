import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const entry = new URL('./preview-consumer.js', import.meta.url)
await writeFile(
  entry,
  `
  const [React, ReactDOM, { OpenFlowPreview }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@oomol-lab/open-flow/preview'),
  ]);
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(OpenFlowPreview, window.previewProps),
  );
`,
)

// Re-bundle the actual package, including lazy editor chunks. The final esbuild
// pass rejects invalid JavaScript emitted by Rollup from pre-minified inputs.
const result = await build({
  configFile: false,
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'error',
  build: {
    target: 'esnext',
    minify: 'esbuild',
    write: false,
    rollupOptions: { input: fileURLToPath(entry) },
  },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output)
assert.ok(outputs.some((output) => output.type === 'chunk' && output.isDynamicEntry))
