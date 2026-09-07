import 'virtual:uno.css'
import '../../src/ui/browser/styles.css'
import '../../src/designer/browser/styles/root.scss'
import '../../src/workbench/browser/runtime/styles.css'
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconifyProvider } from '../../src/designer/browser/icons/iconifyContext.tsx'
import { DesignerLab } from './lab.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Designer Lab root not found.')

createRoot(root).render(
  <StrictMode>
    <IconifyProvider>
      <DesignerLab />
    </IconifyProvider>
  </StrictMode>,
)
