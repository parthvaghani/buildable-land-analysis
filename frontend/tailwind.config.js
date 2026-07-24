/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Map/legend semantics — shared 1:1 across sliders, layer toggles, the
        // breakdown table, and the map itself. Do not repurpose for UI chrome.
        buildable: '#22c55e',   // green-500
        excluded:  '#ef4444',   // red-500

        // Brand accent for UI chrome (focus rings, primary actions, links,
        // spinners) — kept separate from the map/legend colors above.
        brand: {
          DEFAULT: '#0F766E',
          hover:   '#0C5D57',
          light:   '#F0FDFA',
          ring:    '#0F766E',
        },
      },
    },
  },
  plugins: [],
}
