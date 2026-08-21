import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./app/styles/globals.css";
import { SonnerProvider } from "@/app/providers/sonner-provider";
import App from "./App.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <SonnerProvider />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
