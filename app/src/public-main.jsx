import React from 'react'
import { createRoot } from 'react-dom/client'
import PublicSite from './components/PublicSite.jsx'
// The shared page stylesheet (the protected catalogue-page template, never
// changed here) plus this bundle's own site chrome. Never editor.css — the
// public bundle must not pull in the admin UI's styling or code.
import './styles/template.css'
import './styles/public-site.css'

createRoot(document.getElementById('root')).render(<PublicSite />)
