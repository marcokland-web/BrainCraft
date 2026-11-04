import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/prefs'
import { initAuth } from './lib/auth'
import { authChanged } from './lib/store'
import './styles/base.css'
import './styles/glass.css'
import './styles/game.css'
import './styles/learn.css'

// Google-Sitzung des Geräts laden (löst nach der Rückkehr von Google auch den ?code= ein)
initAuth(authChanged)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
