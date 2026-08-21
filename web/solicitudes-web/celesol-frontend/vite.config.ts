import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              priority: 40,
              test: /node_modules[\\/](react|react-dom|react-router-dom)[\\/]/,
            },
            {
              name: "query-vendor",
              priority: 35,
              test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
            },
            {
              name: "calendar-vendor",
              priority: 30,
              test: /node_modules[\\/]react-day-picker[\\/]/,
            },
            {
              name: "ui-vendor",
              priority: 25,
              test: /node_modules[\\/](radix-ui|lucide-react|sonner)[\\/]/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
