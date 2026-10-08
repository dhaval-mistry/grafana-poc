import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin OTLP export avoids browser CORS and never uses JWT headers.
      // Only the three OTLP HTTP paths are relayed to the loopback Alloy port.
      '^/otel/v1/(traces|metrics|logs)$': {
        target: 'http://127.0.0.1:4319',
        rewrite: path => path.replace(/^\/otel/, ''),
      },
    },
  },
})
