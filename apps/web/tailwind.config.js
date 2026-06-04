/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра в духе Linear (тёмная тема).
        bg: '#08090a',
        surface: '#0f1011',
        elevated: '#16171a',
        hover: '#1c1d21',
        border: '#23252a',
        borderSoft: '#1a1c20',
        text: '#e8e8ea',
        muted: '#8a8f98',
        faint: '#5c6066',
        accent: '#5e6ad2',
        accentHover: '#6e79e0',
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
        panel: '0 8px 40px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
};
