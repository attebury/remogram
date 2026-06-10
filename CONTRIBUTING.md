# Contributing

Thanks for your interest in Remogram.

## Getting started

1. Fork and clone [github.com/attebury/remogram](https://github.com/attebury/remogram).
2. Use Node 20+.
3. Install dependencies: `npm ci`
4. Link local packages (optional): `./scripts/npm-link.sh`

## Pull requests

- Open PRs against **`main`**.
- Run `npm test` before submitting.
- Keep changes focused; match existing style in the touched package.
- Remogram CLI/MCP output must stay free of workflow or planning-tool metadata — see [AGENTS.md](AGENTS.md).

## Agent skills

Canonical skills: `tools/remogram-agent-support/skills/`. Full reference: [tools/remogram-agent-support/README.md](tools/remogram-agent-support/README.md).

Skills install from **GitHub** ([`github.com/attebury/remogram`](https://github.com/attebury/remogram)), not from npm — `@remogram/cli` and `@remogram/mcp` do not include skill files.

### Option A — `npx skills`

Works from any machine with Node — no Remogram clone required:

```bash
# Consumer skill (global; use in any repo with .remogram.json)
npx skills add attebury/remogram --skill remogram-consumer -g -a cursor,codex -y

# Contributor skill (project scope in this repo)
npx skills add attebury/remogram --skill remogram-core -a cursor -y
```

### Option B — install script

From a Remogram clone — syncs committed `.cursor/skills/`, Codex globals, and optional Claude plugin:

```bash
./scripts/install-agent-skills.sh --all
```

Use `./scripts/install-agent-skills.sh --cursor --dogfood` on private maintainer checkouts when the dogfood skill is present.

Edit canonical files under `tools/remogram-agent-support/skills/`, then re-run the install script or `npx skills update` for installed copies.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
