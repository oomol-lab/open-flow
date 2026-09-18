import 'virtual:uno.css'
import '@oomol-lab/open-flow/workbench.css'
import './styles.css'

import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'

createRoot(document.getElementById('root')!).render(<App />)
