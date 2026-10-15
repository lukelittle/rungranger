/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for production builds. GitHub Pages cannot send
 * response headers, so the policy is delivered as a <meta> tag. It is added at
 * build time only because the dev server relies on inline scripts for hot reload.
 * The app needs nothing beyond its own origin: no CDNs, web fonts or remote APIs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'rungranger-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
  };
}

// Relative base path so the build works on a GitHub Pages project site
// (https://<user>.github.io/<repo>/) as well as from any sub-folder or file server.
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
