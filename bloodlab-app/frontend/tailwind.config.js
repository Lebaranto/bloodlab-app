/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        'soft': '0 10px 30px rgba(17, 24, 39, 0.08)'
      }
    },
  },
  plugins: [],
}