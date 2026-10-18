/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        navy: { DEFAULT: '#0F1F3D', active: '#1E3463' },
        brand: { DEFAULT: '#1D3F8F', tint: '#E6ECFA' },
        page: '#F4F6FA',
        subtle: '#EEF2F8',
        line: { DEFAULT: '#E1E7F0', strong: '#CBD5E1' },
        ink: { DEFAULT: '#0F172A', 2: '#475569', muted: '#64748B' },
        ok: { bg: '#DCFCE7', text: '#166534', solid: '#15803D' },
        warn: { bg: '#FEF3C7', text: '#92400E', solid: '#B45309' },
        danger: { bg: '#FEE2E2', text: '#991B1B', solid: '#B91C1C' },
        info: { bg: '#DBEAFE', text: '#1E40AF' },
        urgent: { bg: '#FFEDD5', text: '#9A3412' },
      },
    },
  },
  plugins: [],
};
