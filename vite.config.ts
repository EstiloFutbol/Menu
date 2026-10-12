import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Política de seguridad de contenido (CSP) para la versión publicada: la página
// solo puede cargar código propio y conectarse a sí misma y a Supabase. Si alguien
// consiguiera inyectar HTML, el navegador no ejecutaría scripts de otro origen ni
// enviaría datos a otro servidor. Solo se aplica al compilar, porque el servidor
// de desarrollo de Vite necesita scripts en línea.
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : ''
  const supabaseSocket = supabase.replace(/^http/, 'ws')
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    `connect-src 'self' ${supabase} ${supabaseSocket}`.trim(),
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')

  return {
    base: '/Menu/',
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          // El OCR (unos 10 MB) no se guarda en la caché offline: se descarga al leer el primer ticket.
          globIgnores: ['ocr/**'],
        },
        manifest: {
          name: 'Menu',
          short_name: 'Menu',
          description: 'Planificador semanal de comidas, despensa y lista de la compra',
          theme_color: '#f7f7f5',
          background_color: '#f7f7f5',
          display: 'standalone',
          start_url: '/Menu/',
          scope: '/Menu/',
          icons: []
        }
      })
    ]
  }
})
