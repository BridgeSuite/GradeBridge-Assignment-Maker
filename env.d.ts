/// <reference types="vite/client" />

// `import katexCss from 'katex/dist/katex.min.css?raw'` — services/mathRender.ts
// inlines KaTeX's stylesheet into the HTML exports so they render offline.
declare module '*?raw' {
  const src: string;
  export default src;
}
