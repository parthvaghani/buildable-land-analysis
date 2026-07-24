/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        buildable: '#22c55e',   // green-500
        excluded:  '#ef4444',   // red-500
      },
    },
  },
  plugins: [],
}
