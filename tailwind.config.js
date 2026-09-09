/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Independent dark palette (see docs/UI_GUIDELINES.md) - not derived
        // from any existing product's theme.
        bg: "#121417",
        panel: "#1A1D21",
        "panel-alt": "#15181C",
        border: "#2A2F36",
        "border-strong": "#39404A",
        text: "#F4F4F5",
        "text-secondary": "#A1A1AA",
        "text-muted": "#71717A",
        accent: "#4CC2A5",
        "accent-hover": "#5FD6B8",
        "accent-muted": "#1F3F38",
        video: "#3E6E9E",
        audio: "#4E7A56",
        adjustment: "#8A6BB1",
        danger: "#D9534F",
        warning: "#D9A441",
      },
      fontSize: {
        "2xs": ["10px", "13px"],
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
