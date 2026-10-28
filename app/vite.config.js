import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Export/render artefacts may be large and temporarily locked on Windows.
    // They are not application sources and must not terminate the dev watcher.
    watch: { ignored: ['**/.tmp/**', '**/output/**'] },
    // Bind IPv4 loopback explicitly. Left to itself this listened on [::1] ONLY, so
    // any client that resolves "localhost" to 127.0.0.1 — Chrome in some profiles,
    // and the automation used to test this app — got "This site can't be reached"
    // while curl over IPv6 answered 200. 127.0.0.1 is reachable either way and,
    // unlike `host: true`, does not publish the editor to the office network.
    host: '127.0.0.1',
    proxy: {
      // The editor calls /api/* ; hand those to the export/ingest server.
      //
      // An import answers with ONE very large NDJSON line — the drafts carry their
      // images, so it runs to 13 MB — after minutes of progress lines. With the
      // default proxy settings that final line was cut off mid-way ("Invalid EOF
      // state"), so the dialog never saw `done` and sat on "Reading…" forever while
      // the server had in fact finished. Streaming must not be timed out or
      // buffered.
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: { outDir: 'dist' },
})
