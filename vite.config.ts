import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * The SIL Open Font Licence for each self-hosted typeface, copied into the
 * build from the installed package.
 *
 * The deployed site distributes the Inter and Merriweather binaries, and OFL 1.1
 * requires its notice to travel with them. Read from node_modules at build time
 * rather than committed as a copy, so the notice cannot drift away from the
 * version actually shipped.
 */
const fontLicences = (): Plugin => {
  const FACES = [
    { pkg: '@fontsource/inter', out: 'fonts/Inter-OFL.txt' },
    { pkg: '@fontsource/merriweather', out: 'fonts/Merriweather-OFL.txt' },
  ];
  return {
    name: 'gb-font-licences',
    async generateBundle() {
      for (const { pkg, out } of FACES) {
        const dir = dirname(fileURLToPath(import.meta.resolve(`${pkg}/package.json`)));
        this.emitFile({ type: 'asset', fileName: out, source: await readFile(join(dir, 'LICENSE'), 'utf8') });
      }
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  base: '/GradeBridge-Assignment-Maker/',
  plugins: [dataUriAssets(), fontLicences(), react()],
  server: {
    port: 3000,
  },
});
