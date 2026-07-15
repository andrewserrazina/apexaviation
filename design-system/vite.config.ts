import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ApexDesignSystem',
      fileName: () => 'apex-design-system.js',
      formats: ['es'],
    },
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: { react: 'React', 'react-dom': 'ReactDOM' },
        assetFileNames: (info) => {
          const name = info.name ?? info.names?.[0] ?? 'asset'
          return name.endsWith('.css') ? 'apex-design-system.css' : name
        },
      },
    },
  },
})
