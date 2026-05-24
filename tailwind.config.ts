import type { Config } from 'tailwindcss'

/**
 * Project HPF Admin design tokens.
 *
 * Border-radius scale is intentionally pushed up vs Tailwind defaults to
 * create a softer, more welcoming feel — appropriate for a foundation /
 * community admin tool rather than a hard-edged finance dashboard.
 *
 * Use convention:
 *   - rounded-lg     → small chips, badges, tags
 *   - rounded-xl     → form inputs, dense cards
 *   - rounded-2xl    → standard buttons, primary cards (default for most UI)
 *   - rounded-3xl    → hero CTAs, large modal containers
 *   - rounded-full   → pill buttons, avatars, action chips
 *
 * Brand palette is cosmic dark + cyan/violet to match members portal.
 */
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand: cosmic dark base with cyan/violet accents.
        brand: {
          50:  '#e0f2fe',  // pale cyan
          100: '#bae6fd',
          400: '#7dd3fc',  // primary cyan accent (matches members portal)
          500: '#0ea5e9',
          600: '#0489c7',  // members portal primary
          violet:    '#a78bfa',
          violetDeep:'#7c3aed',
          night:     '#0a1428',  // sidebar base
          deep:      '#020108',  // page background
        },
        // Surfaces for cards / modals over the cosmic background.
        surface: {
          DEFAULT: '#0a1428',
          raised:  '#0d1933',
          sunken:  '#050b1c',
        },
        // Text on dark surfaces.
        ink: {
          DEFAULT: '#e2f0ff',
          muted:   'rgba(220,236,255,0.65)',
          subtle:  'rgba(220,236,255,0.4)',
        },
      },
      borderRadius: {
        // Softer scale than Tailwind defaults.
        'lg':   '0.75rem',   // 12px (was 8px)
        'xl':   '1rem',      // 16px (was 12px)
        '2xl':  '1.25rem',   // 20px (was 16px)
        '3xl':  '1.75rem',   // 28px (was 24px)
        '4xl':  '2.5rem',    // 40px — for hero containers
        'pill': '9999px',
      },
      boxShadow: {
        // Glowy shadows that pair with the cosmic palette. Use sparingly.
        'glow-cyan':   '0 0 30px rgba(125,211,252,0.35)',
        'glow-violet': '0 0 30px rgba(167,139,250,0.35)',
        'card':        '0 4px 16px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15)',
        'card-lg':     '0 12px 40px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
}
export default config
