import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/template.css'
import './styles/editor.css'

async function start() {
  if (new URLSearchParams(location.search).get('print') === '1' && window.__CATALOGUE_BOOTSTRAP__) {
    await window.__CATALOGUE_BOOTSTRAP__
  }
  createRoot(document.getElementById('root')).render(<App />)
}
start().catch(error => { document.getElementById('root').textContent=`Export failed: ${error.message}` })
