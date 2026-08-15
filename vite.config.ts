import { readFile } from 'node:fs/promises';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `import font from '…/KaTeX_Main-Regular.woff2?dataurl'` → a base64 data URI.
 *
 * Vite's own `?inline` is not honoured for these in a production build — it
 * emits a hashed file and hands back its URL — and the exported HTML and the
 * PDF rasteriser both need the bytes, not a link. Written out here so the
 * behaviour is the same in dev, in build, and in the esbuild the test runner
 * uses (tests/run-tests.mjs mirrors this).
 */
const dataUriAssets = (): Plugin => {
  const SUFFIX = '?dataurl';
  const MIME: Record<string, string> = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
  };
  return {
    name: 'gb-datauri-assets',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return resolved ? resolved.id + SUFFIX : null;
    },
    async load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      const ext = file.split('.').pop() || '';
      const base64 = (await readFile(file)).toString('base64');
      return `export default ${JSON.stringify(`data:${MIME[ext] || 'application/octet-stream'};base64,${base64}`)};`;
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  base: '/GradeBridge-Assignment-Maker/',
  plugins: [dataUriAssets(), react()],
  server: {
    port: 3000,
  },
});
