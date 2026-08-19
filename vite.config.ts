import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The webcam (getUserMedia) requires a secure context.
// - Production  : Vercel serves the site over HTTPS automatically.
// - Local dev   : basicSsl() gives us https:// on the LAN IP so a second
//                 laptop can open the dev server and still get camera access.
export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [basicSsl()] : [],
  server: {
    host: '0.0.0.0',
    port: 5000,
    open: true
  },
  preview: {
    port: 4173
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          tf: [
            '@tensorflow/tfjs-core',
            '@tensorflow/tfjs-converter',
            '@tensorflow/tfjs-backend-webgl',
            '@tensorflow-models/hand-pose-detection',
            '@tensorflow-models/face-detection'
          ],
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['fingerpose']
  }
}));
