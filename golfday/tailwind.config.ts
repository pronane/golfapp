import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fairway: {
          50: "#eefaf2", 100: "#d6f2e0", 200: "#b0e5c6", 300: "#7bd0a5",
          400: "#44b581", 500: "#219a67", 600: "#137c53", 700: "#116345",
          800: "#114f39", 900: "#0f4130", 950: "#04241a",
        },
        sand: { 50: "#fdf9f0", 100: "#f9efd8", 200: "#f1dcae", 300: "#e7c27a", 400: "#dda64e", 500: "#d28d2f" },
        ink: "#0b1712",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(4,36,26,.06), 0 8px 24px -12px rgba(4,36,26,.25)",
      },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(33,154,103,.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(33,154,103,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(33,154,103,0)" },
        },
        "flash-in": { "0%": { backgroundColor: "rgba(221,166,78,.35)" }, "100%": { backgroundColor: "transparent" } },
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
