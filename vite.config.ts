import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The webcam (getUserMedia) requires a secure context.
// - Production  : Vercel serves the site over HTTPS automatically.
// - Local dev   : basicSsl() gives us https:// on the LAN IP so a second
//                 laptop can open the dev server and still get camera access.
export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [basicSsl()] : [],
  resolve: {
    alias: {
      // The MediaPipe solution packages register their exports at runtime, so a
      // bundler cannot extract `Hands` / `FaceDetection` from them. index.html
      // loads the real solutions as classic scripts and these shims hand the
      // globals back to TensorFlow.js under the names it imports.
      '@mediapipe/hands': fileURLToPath(new URL('./src/shims/mediapipe-hands.ts', import.meta.url)),
      '@mediapipe/face_detection': fileURLToPath(new URL('./src/shims/mediapipe-face.ts', import.meta.url))
    }
  },
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
          ]
        }
      }
    }
  },
  optimizeDeps: {
    include: ['fingerpose'],
    exclude: ['@mediapipe/hands', '@mediapipe/face_detection']
  }
}));
