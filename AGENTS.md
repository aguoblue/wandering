# Repository Guidelines

## Project Structure & Module Organization
This repository contains a Vite-based React app at the repository root plus a few supporting notes. Treat the root app as the main product codebase.

- `src/`: application code, with `components/` for UI and map features such as `AmapMap.jsx` and `SearchBox.jsx`
- `src/assets/` and `public/`: static assets and icons
- `package.json`: scripts and dependencies
- `history.md`: chronological change log that should be updated after relevant code changes
- `test-click-functionality.md`: current manual test checklist for map click behavior
- `standalone-demo.html`: archived standalone demo kept outside the main app flow

The root `index.html` now belongs to the main Vite app.

## Build, Test, and Development Commands
Run commands from the repository root.

- `npm install`: install dependencies
- `npm run dev`: start the Vite dev server with hot reload
- `npm run build`: create a production build in `dist/`
- `npm run preview`: serve the production build locally
- `npm run lint`: run ESLint on all `js` and `jsx` files

## Coding Style & Naming Conventions
Follow the existing React style: functional components, ES modules, and 2-space indentation with semicolon-free JavaScript. Use PascalCase for component files (`AmapMap.jsx`, `Favorites.jsx`) and camelCase for local variables and handlers (`handleMapClick`, `searchEndPoint`).

Keep map integration code imperative inside `useEffect`/refs, and clean up AMap instances on unmount. Run `npm run lint` before opening a PR; ESLint is configured in the root `eslint.config.js` with React Hooks and React Refresh rules.

## Testing Guidelines
There is no automated test suite yet. For now, treat linting plus manual verification as the minimum check:

- `npm run lint`
- validate search, geolocation, route planning, and map click behavior in the dev server
- use `test-click-functionality.md` as a reference for click-to-select destination testing

When adding features, include reproducible manual test steps in your PR and update `history.md` with the relevant change summary.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects, sometimes with a conventional prefix such as `fix:` (`fix: prevent search suggestions when clicking map point`). Keep new commits focused and descriptive.

Pull requests should include:

- a brief problem/solution summary
- linked issue or task, if one exists
- screenshots or a short recording for UI or map interaction changes
- notes about env vars, manual test steps, and any AMap-specific setup

## Security & Configuration Tips
Do not commit secrets. Configure AMap through the root `.env` with `VITE_AMAP_KEY` and, when required, `VITE_AMAP_SECURITY_CODE`. The app depends on valid AMap credentials and network access for geocoding, search, and routing features.
