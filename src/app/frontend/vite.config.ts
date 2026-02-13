import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

// Help resolve libsodium path
const libsodiumSumoPath = path.resolve(
  __dirname,
  '../../../node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      './libsodium-sumo.mjs': libsodiumSumoPath,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'resolve-libsodium-sumo',
          setup(build) {
            build.onResolve({ filter: /\.\/libsodium-sumo\.mjs$/ }, () => ({
              path: libsodiumSumoPath,
            }))
          },
        },
      ],
    },
  },
})
