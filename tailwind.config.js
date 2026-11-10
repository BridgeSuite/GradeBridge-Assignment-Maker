/**
 * Tailwind, at build time.
 *
 * This replaces the `tailwind.config = {…}` block that used to sit inline in
 * index.html and be consumed by the Play CDN (cdn.tailwindcss.com). Every value
 * below is carried over from it unchanged — see docs/session/ for the audit that
 * removed the CDN.
 *
 * PINNED TO TAILWIND v3 (see package.json). v4 is a different product: CSS-first
 * configuration, no tailwind.config.js by default, and changed default styles.
 * cdn.tailwindcss.com served v3, so v3 is what reproduces the current appearance.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // Every file that can carry a class name. A build-time pass only sees literal
  // strings in source — unlike the Play CDN, which compiled against the live DOM
  // — so a class assembled from fragments at runtime would not be generated.
  // There are none today (all interpolations are complete static strings); if
  // one is ever introduced, either make it a complete literal or safelist it.
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // UC Davis sets its sites in Proxima Nova (licensed, not bundled): it
        // is used where the computer has it, and the bundled Figtree otherwise.
        // Headings are the same face at a heavy weight, as on ucdavis.edu, so
        // `serif` is no longer a separate face.
        sans: ['proxima-nova', 'Figtree', 'system-ui', 'sans-serif'],
        serif: ['proxima-nova', 'Figtree', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Load-bearing: `bg-academic-50 text-academic-900` is on <body>, and the
        // app uses this scale throughout, so re-colouring it re-themes the app.
        //
        // THE UC DAVIS THEME (2026-11-04). The values are the brand tokens
        // ucdavis.edu declares (`--ucd-blue` #022851, `--brand-primary-*`);
        // steps marked (*) are not tokens there and sit between them. The
        // light steps are the site's blue tints, the text steps are a
        // blue-grey, 800 is Aggie Blue (the primary button), 900 near-black.
        academic: {
          50: '#f7fafd',   // brand-primary-20
          100: '#ebf3fa',  // brand-primary-30
          200: '#dbeaf7',  // brand-primary-40
          300: '#b0d0ed',  // brand-primary-60
          400: '#8796aa',  // (*)
          500: '#5c6b80',  // (*)
          600: '#45546a',  // (*)
          700: '#14447a',  // brand-primary-90
          800: '#022851',  // ucd-blue, Aggie Blue
          900: '#011a36',  // (*)
        },
        // The brand blue's brighter step, for page titles as on ucdavis.edu.
        aggie: { 500: '#13639e' },  // brand-primary-80
        // Aggie Gold: the accent, and the one action that matters on a screen.
        gold: {
          50: '#fffbed',   // brand-secondary-20
          100: '#fff4d2',  // brand-secondary-40
          300: '#ffdf80',  // brand-secondary-70
          400: '#ffd24c',  // brand-secondary-80
          500: '#ffbf00',  // ucd-gold, Aggie Gold
        },
      },
    },
  },
  plugins: [],
};
