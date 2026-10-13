// Where the API lives.
//
// In development the editor is served by Vite on :5173 and the extraction/export
// server runs on :5174. Calls used to go through Vite's dev proxy — and a long
// streamed response LOST ITS TAIL there: an import delivered 49 of its 50 parts and
// then stalled until the client timed out, every time, while the same request
// straight to :5174 finished in zero seconds. The import dialog sat on "Reading…"
// forever although the server had done the work.
//
// So the browser talks to the API directly and the server allows it (CORS). The
// proxy is a development convenience, not part of the product: in a build the app
// and the API are same-origin and `apiUrl` returns the plain path unchanged.

const DEV_UI_PORT = '5173'
const API_PORT = '5174'

export const apiUrl = path => {
  if (typeof location === 'undefined') return path
  if (location.port !== DEV_UI_PORT) return path
  return `${location.protocol}//${location.hostname}:${API_PORT}${path}`
}
