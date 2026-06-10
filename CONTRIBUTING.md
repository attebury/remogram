# Contributing

Thanks for your interest in Remogram.

## Getting started

1. Fork and clone [github.com/attebury/remogram](https://github.com/attebury/remogram).
2. Use Node 20+.
3. Install dependencies: `npm ci`
4. Link local packages (optional): `./scripts/npm-link.sh`

Topogram is **not** required to build or test Remogram.

## Pull requests

- Open PRs against **`main`**.
- Run `npm test` before submitting.
- Keep changes focused; match existing style in the touched package.
- Remogram CLI/MCP output must stay free of SDLC or workflow concepts — see [AGENTS.md](AGENTS.md).

## Agent skills

Consumer and contributor skills live under `tools/remogram-agent-support/skills/`. Install locally with:

```bash
./scripts/install-agent-skills.sh --all
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
