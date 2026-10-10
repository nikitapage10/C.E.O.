# Working on C.E.O.

- **Deploys:** Vercel builds production from `main`. When a round of work is done and verified (typecheck, lint, unit tests, build), commit and push it to `main` as well as the working branch. The owner has asked for every finished change to go straight to production.
- **Checks:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; `npm run test:e2e` for the browser tests (set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium).
- **Characters in-world:** the Syntherion know they live in a simulation but stay in the world of Ilyr. No jokes about code, GPUs or React. Pop-culture costumes are legally distinct, one per work, never the protagonist (Rocky is the exception).
