/** @type {import('tailwindcss').Config} */
export default {
  // With @tailwindcss/vite (Tailwind v4), content is not required.
  // content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // Override defaults (not extend)
    borderWidth: {
      DEFAULT: 'max(0.1rem, 0.1em)',
      0: '0',
      1: 'max(0.1rem, 0.1em)',
      2: '0.25rem',
      3: '0.5rem',
      4: '1rem',
      5: '2rem',
    },
    borderRadius: {
      none: '0',
      xs: '0.1rem',
      DEFAULT: '0.125rlh',
      sm: '0.25rem',
      md: '0.5rem',
      lg: '1rem',
      xl: '2rem',
      '2xl': '4rem',
      '1em': '1em',
      '1lh': '1lh',
      full: '9999px',
    },
  },
  plugins: [],
};