import React from 'react';
import ReactDOM from 'react-dom/client';
// Bundled rather than loaded from a CDN: the preview must render math offline,
// and the PDF exporter rasterises KaTeX output from this same stylesheet.
import 'katex/dist/katex.min.css';
// Tailwind, compiled at build time from ./tailwind.config.js. This replaced
// cdn.tailwindcss.com, which shipped executable JavaScript from a third party
// with full page privileges and no Subresource Integrity attribute.
import './index.css';
// The two typefaces, self-hosted for the same reason and emitted same-origin by
// Vite. @fontsource ships Inter v20 and Merriweather v33 — the same upstream
// versions fonts.gstatic.com was serving — with their SIL Open Font Licences.
// Weights are exactly those the old Google Fonts <link> requested, and no more.
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/merriweather/300.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
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
