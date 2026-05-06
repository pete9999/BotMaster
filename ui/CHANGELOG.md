# BotMaster — Changelog

## v0.002 — 2026-05-04
BotMaster rebrand throughout (was "Factory"). Batman yellow and black colour scheme. 
"Deploy" / "Recall" replacing Spawn / Kill in the workers page.  
Hub offline banner added — when hub isn't running you now get a clear prompt to try demo mode instead of a silent empty page.  
Self-refresh indicator in header (spinning icon while background fetches are in progress).  
Version number shown in sidebar footer.  
This changelog and rules file started.

## v0.001 — 2026-05-04
Initial full UI build. Dashboard, Projects (list + create), Project Detail (task kanban with dependency 
tracking, workers tab, logs tab), Workers (deploy modal, kill), Logs (SSE live viewer with filters), 
Settings (config editor). Demo/mock mode with simulated Luminary project data, live log simulator, 
mutations that persist in-memory. All pages TypeScript-clean, production build working.
