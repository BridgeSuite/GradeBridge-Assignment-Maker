/// <reference types="vite/client" />

// `import katexCss from 'katex/dist/katex.min.css?raw'` — services/mathRender.ts
// inlines KaTeX's stylesheet into the HTML exports so they render offline.
declare module '*?raw' {
  const src: string;
  export default src;
}

// `?dataurl` is our own Vite plugin (see vite.config.ts): the asset's bytes as a
// base64 data URI. services/katexFonts.ts embeds KaTeX's glyph fonts with it.
declare module '*?dataurl' {
  const src: string;
  export default src;
}
