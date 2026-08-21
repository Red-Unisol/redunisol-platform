# Celesol Frontend

Initial frontend bootstrap with a minimal and clean base for development.

## Stack

- React 19
- Vite 8
- TypeScript 6
- Tailwind CSS 4
- shadcn/ui
- React-Hook-Form
- React Router
- React Query

## Current Status

- Base project initialized and compiling correctly.
- Vite visual scaffold removed.
- `BrowserRouter` integrated at startup.
- `React Query` installed, pending provider integration when needed.
- `shadcn/ui` initialized with base utilities and theme setup.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Target Folder Structure

The following structure is the intended organization for the project as development grows. It is a reference for the architecture, not a guarantee that every file already exists today.

```text
src/
  app/
    router/
      index.tsx
      private-routes.tsx
    providers/
      query-provider.tsx
      theme-provider.tsx
    layouts/
      app-layout.tsx
      auth-layout.tsx
    styles/
      globals.css

  modules/
    auth/
      pages/
        login-page.tsx
      components/
        login-form.tsx
      services/
        auth.service.ts
      types/
        auth.types.ts

    solicitudes-precarga/
      pages/
        solicitudes-precarga-page.tsx
      components/
        precarga-table.tsx
        precarga-toolbar.tsx
        precarga-filters.tsx
      services/
        solicitudes-precarga.service.ts
      types/
        solicitudes-precarga.types.ts

  shared/
    components/
      ui/
        button.tsx
        input.tsx
        select.tsx
        modal.tsx
        table.tsx
      feedback/
        loader.tsx
        empty-state.tsx
        error-state.tsx
    hooks/
      use-debounce.ts
      use-pagination.ts
    services/
      api-client.ts
    utils/
      format-date.ts
      format-currency.ts
    types/
      common.types.ts
    constants/
      routes.ts
      query-keys.ts

  assets/
    icons/
    images/

  main.tsx
```

## Notes

- The app currently starts with a minimal neutral screen, ready to grow into routes, layouts, and features.
- This README documents the intended folder structure even if parts of it have not been created yet.
