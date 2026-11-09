import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// No app empacotado a janela abre em file:///.../index.html: BrowserRouter usaria o caminho do arquivo
// como rota e um reload (F5) tentaria abrir C:\agentes no disco. HashRouter (#/agentes) funciona em file://.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
