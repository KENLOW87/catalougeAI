import React from 'react'
import { createRoot } from 'react-dom/client'
import PublicSite from './components/PublicSite.jsx'
// The shared page stylesheet only — never editor.css. The public bundle must
// not pull in the admin UI's styling or code.
import './styles/template.css'

createRoot(document.getElementById('root')).render(<PublicSite />)
