import React from 'react';
import ReactDOM from 'react-dom/client';
// Bundled rather than loaded from a CDN: the preview must render math offline,
// and the PDF exporter rasterises KaTeX output from this same stylesheet.
import 'katex/dist/katex.min.css';
// Tailwind, compiled at build time from ./tailwind.config.js. This replaced
// cdn.tailwindcss.com, which shipped executable JavaScript from a third party
// with full page privileges and no Subresource Integrity attribute.
import './index.css';
// The typeface, self-hosted and emitted same-origin by Vite. UC Davis sets its
// sites in Proxima Nova, which is licensed and cannot be bundled; Figtree is
// the free (SIL Open Font Licence) face closest to it, and tailwind.config.js
// names proxima-nova first so a computer that has it uses it.
import '@fontsource/figtree/300.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/figtree/800.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
