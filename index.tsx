import React from 'react';
import ReactDOM from 'react-dom/client';
// Bundled rather than loaded from a CDN: the preview must render math offline,
// and the PDF exporter rasterises KaTeX output from this same stylesheet.
import 'katex/dist/katex.min.css';
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