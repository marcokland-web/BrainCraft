import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/prefs'
import './styles/base.css'
import './styles/glass.css'
import './styles/game.css'
import './styles/learn.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
