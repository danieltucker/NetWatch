/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Matches the CSS sidebar-collapse breakpoint (index.css @media max-width:1180px)
      screens: {
        wide: '1181px',
      },
    },
  },
  plugins: [],
};
