import { initializeWorkspace } from './data/initializeWorkspace'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.jsx'
import { applySettings, loadSettings } from './data/settings'
import './styles/theme.css'

initializeWorkspace()
applySettings(loadSettings())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
