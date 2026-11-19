import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const isShareBuild = mode === 'share'

  return {
    plugins: [react(), tailwindcss(), ...(isShareBuild ? [viteSingleFile()] : [])],
    ...(isShareBuild
      ? {
          build: {
            outDir: 'dist-share',
            assetsInlineLimit: 100_000_000,
            cssCodeSplit: false,
          },
        }
      : {}),
  }
})