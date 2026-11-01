import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A soft, pastel-forward sage. 100-300 are fills, 700-950 are text,
        // so a pastel button can sit on cream and still be readable.
        fairway: {
          50: "#f4f9f5", 100: "#e6f1ea", 200: "#d0e6d8", 300: "#b2d5c1",
          400: "#94c2a9", 500: "#77a98d", 600: "#5e8f75", 700: "#4b7460",
          800: "#3d5f4e", 900: "#33503f", 950: "#2a4136",
        },
        sand: {
          50: "#fdf8ef", 100: "#faefda", 200: "#f4e0bd", 300: "#eccb9a",
          400: "#e0b478", 500: "#cf9a58", 600: "#b17f42", 700: "#8d6535",
        },
        blush: {
          50: "#fdf3f1", 100: "#fbe5e1", 200: "#f6d2cb", 300: "#eeaea5",
          400: "#e2938a", 500: "#cd756c", 600: "#ae5d55",
        },
        lilac: { 50: "#f7f5fb", 100: "#eeeaf6", 200: "#ded6ec", 300: "#c5b8dd" },
        ink: "#2b3a31",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(42,65,54,.05), 0 10px 30px -18px rgba(42,65,54,.28)",
      },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(119,169,141,.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(119,169,141,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(119,169,141,0)" },
        },
        "flash-in": { "0%": { backgroundColor: "rgba(224,180,120,.28)" }, "100%": { backgroundColor: "transparent" } },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "flash-in": "flash-in 1.4s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
