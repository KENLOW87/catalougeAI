import React from 'react'
import { createRoot } from 'react-dom/client'
import PublicSite from './components/PublicSite.jsx'
// The shared page stylesheet (the protected catalogue-page template, never
// changed here), this bundle's own site chrome, and — now that
// PUBLIC_CATALOGUE_EDIT can put the admin's BotPanel/ProductDialog on this
// same page — editor.css too, since that is the only place their styling
// (.bot-*, .proposal, .gallery-field, etc.) is defined. Unused admin-only
// rules (.dashboard-*, etc.) just go along for the ride; not worth a second
// stylesheet split for this.
import './styles/template.css'
import './styles/public-site.css'
import './styles/editor.css'

createRoot(document.getElementById('root')).render(<PublicSite />)
