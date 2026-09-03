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
        sans: ['Inter', 'sans-serif'],
        serif: ['Merriweather', 'serif'],
      },
      colors: {
        // Load-bearing: `bg-academic-50 text-academic-900` is on <body>, and the
        // app uses this scale throughout. The ten values are Tailwind's default
        // `slate`, but the class names in the source say `academic` — do not
        // "simplify" this away.
        academic: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
      },
    },
  },
  plugins: [],
};
