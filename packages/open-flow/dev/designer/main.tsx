import 'virtual:uno.css'
import '@oomol-lab/open-flow/workbench.css'
import './styles.css'
import './lab.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconifyProvider } from '../../src/ui/browser/icons/iconifyContext.tsx'
import { FrontendLab } from './lab.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Open Flow Lab root not found.')

createRoot(root).render(
  <StrictMode>
    <IconifyProvider>
      <FrontendLab />
    </IconifyProvider>
  </StrictMode>,
)
