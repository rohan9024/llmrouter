# AGENTS.md — Contributing to @rohan9024/llmrouter

- Runtime dependencies in `package.json` MUST remain zero (`dependencies` omitted).
- Minimum Node.js version is `>=22` (CI tests 22, 24, 26).
- All relative TypeScript imports in `src/` MUST use `.js` extensions (`NodeNext`).
- Never log unredacted API keys or user prompts by default.
- Always run `npm run typecheck && npm test && npm run build` before finishing changes.