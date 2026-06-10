/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра через CSS-переменные — общая для тёмной и светлой темы.
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        hover: 'var(--hover)',
        border: 'var(--border)',
        borderSoft: 'var(--borderSoft)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        accent: 'var(--accent)',
        accentHover: 'var(--accentHover)',
        accent2: 'var(--accent2)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': ['11px', '15px'],
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
      },
    },
  },
  plugins: [],
};
