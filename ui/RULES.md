# BotMaster UI — Rules

These rules apply every time code changes are made to this project.

## 1. Version Bumping
- Every batch of changes increments `src/version.ts` by 0.001 (e.g. 0.001 → 0.002)
- No git required — just update the file
- The version shows in the sidebar footer of the running app

## 2. Changelog
- Every version bump gets a new entry at the top of `CHANGELOG.md`  
- Entry format: `## vX.XXX — YYYY-MM-DD`  
- Write in plain English — not just a list of file names  
- 3–6 lines max. What changed and why, not how

## 3. Self-Refresh
- All data queries must use `refetchInterval` (workers: 5s, tasks: 8s, projects: 15s)
- The header shows a spinning icon whenever background fetches are in progress
- When the hub is unreachable, show a clear banner offering demo mode — never a silent empty page

## 4. Naming
- The app is called **BotMaster** everywhere — UI, HTML title, comments, logs
- Workers → Bots (in UI labels only; API and code variables stay as `worker`)
- Projects → Missions (in UI labels; code stays `project`)
- Spawn → Deploy, Kill → Recall (in button labels; function names stay the same)
- Hub → Batcave (in UI copy; API paths stay `/api/...`)
