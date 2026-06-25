# Public documentation Topogram audit

Audit date: 2026-06-14. Goal: keep the GitHub / `npx skills` / npm surface Remogram-centric; Topogram appears only as provenance.

## Export boundary

`scripts/export-public-main.sh` removes private dogfood paths and strips `<!-- maintainer-only -->` blocks from `AGENTS.md`, `README.md`, and `tools/remogram-agent-support/README.md`.

Regression gates: `tests/export/export-denylist.test.mjs`, `tests/export/public-topogram-allowlist.test.mjs`.

## Public Topogram allowlist

Topogram may appear only as:

- Provenance: “developed by and for Topogram” + `https://topogram.dev` (`README.md`, `llms.txt`)
- Historical release notes in `CHANGELOG.md` (no rewrite of shipped notes)

## Inventory (pre-remediation → verdict)

| File | Section | Tier | Verdict | Action |
|------|---------|------|---------|--------|
| `README.md` L7 | Provenance | public-export | keep | — |
| `README.md` L161–174 | Semantic diff table | public-export | rewrite | Neutral planning-tool language |
| `README.md` L271 | Local Gitea CI | public-export | move-to-maintainer | `maintainer-only` block |
| `README.md` L370 | Dogfood install | public-export | move-to-maintainer | `maintainer-only` block |
| `llms.txt` L5 | Provenance | public-export | keep | — |
| `CHANGELOG.md` beta.3 | Historical note | public-export | keep | — |
| `remogram-consumer/SKILL.md` L78–118 | Topogram queries | public-skill-npx | rewrite | Remogram-only fact inventory |
| `remogram-core/SKILL.md` L48 | “Topogram owns” | public-skill-npx | rewrite | External planning tools |
| `tools/remogram-agent-support/README.md` L24–98 | Lane experiment | public-export | move-to-maintainer | `maintainer-only` block |
| `tools/gitea/README.md` | Dogfood Gitea | internal-ok | strip-on-export | Added to export denylist |
| `adapters/.../remogram-maintainer.mdc` | Park topogram | internal-ok | strip-on-export | Added to export denylist |
| `packages/.../observer-fact-inventory.js` | JSDoc @see topogram | npm-package | rewrite | Neutral consumer wording |
| `packages/.../semantic-diff-facts.js` | Comments | npm-package | rewrite | Neutral workflow wording |
| `packages/.../envelope.js` | Error message | npm-package | rewrite | Forbidden workflow key |
| `scripts/run-gitea-gate.sh` | stub_topogram_engine | internal-ok | strip-on-export | Added to export denylist |
| Dogfood skills (`dogfood-skills.list`) | All Topogram refs | internal-ok | — | Already stripped |

## Remediation checklist (by visibility)

1. **High — `npx skills`:** `remogram-consumer`, `remogram-core` — done
2. **High — GitHub landing:** `README.md` semantic-diff + maintainer blocks — done
3. **Medium — agent support:** `tools/remogram-agent-support/README.md` split — done
4. **Low — npm JSDoc:** contract module comments — done
5. **Gate — export test:** `public-topogram-allowlist.test.mjs` — done

## Verification

```bash
npm test -- tests/export/
bash scripts/export-public-main.sh /tmp/remogram-public-audit
rg -i topogram /tmp/remogram-public-audit/README.md /tmp/remogram-public-audit/llms.txt
# Expect provenance lines only; CHANGELOG historical lines OK
```

## Out of scope

- Internal dogfood skills and `topo/` SDLC records
- Rewriting historical CHANGELOG release sections
- Topogram engine documentation
