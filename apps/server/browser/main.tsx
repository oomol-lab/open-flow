import 'virtual:uno.css'
import '@oomol-lab/open-flow/workbench.css'
import './host-ui.css'
import './styles.css'

import { createRoot } from 'react-dom/client'

async function start(): Promise<void> {
  if (import.meta.env.DEV) {
    const { signInFromDevelopmentLink } = await import('./development-login.ts')
    await signInFromDevelopmentLink()
  }
  const { App } = await import('./app.tsx')
  createRoot(document.getElementById('root')!).render(<App />)
}

void start()
