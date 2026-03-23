export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#2563EB',
          orange: '#F97316',
          green: '#16A34A',
          amber: '#F59E0B',
          red: '#DC2626',
          slate: '#64748B',
          ink: '#0F172A',
          grid: '#E2E8F0',
          yellow: '#F59E0B',
        },
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
}
