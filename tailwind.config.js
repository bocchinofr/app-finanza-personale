/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        // Verde salvia — accent primario (era blu SaaS generico)
        brand: {
          50:  '#f1f5ec',
          100: '#e1ead5',
          200: '#c5d8b0',
          400: '#7fa06c',
          500: '#5c8752',
          600: '#3f6b4f',
          700: '#2f5233',
          800: '#234026',
          900: '#162b19',
        },
        // Blu ardesia — accent secondario (investimenti, dati "informativi")
        accent2: {
          50:  '#eef2f6',
          100: '#dbe4ec',
          500: '#5b7a99',
          600: '#4a6fa1',
          700: '#3c5a82',
        },
        // Toni carta caldi — sfondi e bordi (erano grigio-blu freddo)
        surface: {
          0:   '#ffffff',
          50:  '#f5f6f0',
          100: '#ececE1',
          200: '#d8dcc9',
          300: '#c3c9b0',
          400: '#a9b092',
        }
      }
    },
  },
  plugins: [],
}
