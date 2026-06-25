const COMMAND_HELP = Object.freeze({
  'cr open': `Usage: remogram cr open --head <branch> --base <branch> --title <text> [--body <text>] [--idempotency-key <key>] [--json]

Required:
  --head <branch>           Forge branch name (not remote/ref shape)
  --base <branch>           Target integration branch name
  --title <text>            Change request title

Optional:
  --body <text>             Change request body
  --idempotency-key <key>   Scoped idempotency fingerprint
  --json                    Emit JSON packets`,

  'issue open': `Usage: remogram issue open --title <text> [--body <text>] [--idempotency-key <key>] [--json]

Required:
  --title <text>            Issue title

Optional:
  --body <text>             Issue body
  --idempotency-key <key>   Scoped idempotency fingerprint
  --json                    Emit JSON packets`,

  'issue view': `Usage: remogram issue view --number <n> [--json]

Required:
  --number <n>              Issue number

Optional:
  --json                    Emit JSON packets`,

  'issue inventory': `Usage: remogram issue inventory [--slice-ref <ref>] [--limit <n>] [--sort <field>] [--cursor <cursor>] [--json]

Read open issues from the configured forge.`,

  'issue comments': `Usage: remogram issue comments --number <n> [--json]

Required:
  --number <n>              Issue number

Optional:
  --json                    Emit JSON packets`,

  'status set': `Usage: remogram status set --sha <commit> --context <name> --state <pending|success|failure|error> [--description <text>] [--target-url <url>] [--json]

Required:
  --sha <commit>            40-character commit SHA
  --context <name>          Commit status context
  --state <state>           pending, success, failure, or error

Optional:
  --description <text>      Status description
  --target-url <url>        Target URL for the status
  --json                    Emit JSON packets`,

  'merge execute': `Usage: remogram merge execute --number <n> --expected-base-sha <sha> --expected-head-sha <sha> [--method merge] [--json]

Required:
  --number <n>              Open change request number
  --expected-base-sha <sha> Reviewed integration base SHA (40 hex chars)
  --expected-head-sha <sha> Reviewed candidate SHA (40 hex chars)

Optional:
  --method merge            Only merge is supported in v1
  --json                    Emit JSON packets`,

  'verify bind': `Usage: remogram verify bind --target-sha <sha> [--verifier <id>] [--proof-url <url>] [--note <text>] [--json]

Required:
  --target-sha <sha>        40-character verified target SHA

Optional:
  --verifier <id>           Verifier identity or lane label
  --proof-url <url>         Receipt, run, or report URL
  --note <text>             Additional verification context
  --json                    Emit JSON packets`,

  'review bundle': `Usage: remogram review bundle --number <n> [--reviewed-head-sha <sha>] [--reviewed-base-sha <sha>] [--decision <approved|changes_requested|commented>] [--summary <text>] [--json]

Required:
  --number <n>              Reviewed change request number

Optional:
  --reviewed-head-sha <sha> Reviewed head SHA
  --reviewed-base-sha <sha> Reviewed base SHA
  --decision <value>        approved, changes_requested, or commented
  --summary <text>          Review summary for handoff
  --json                    Emit JSON packets`,

  'issue bundle': `Usage: remogram issue bundle --issue-number <n> [--state <open|closed>] [--title <text>] [--url <url>] [--linked-pr <n>] [--json]

Required:
  --issue-number <n>        Issue number to bundle

Optional:
  --state <state>           open or closed
  --title <text>            Issue title snapshot
  --url <url>               Issue URL
  --linked-pr <n>           Related change request number
  --json                    Emit JSON packets`,

  'cr inventory': `Usage: remogram cr inventory [--slice-ref <ref>] [--limit <n>] [--sort <field>] [--cursor <cursor>] [--json]

Read open change requests from the configured forge.`,

  contract: `Usage: remogram contract [--command "<group subcommand>"] [--json]

Read exported command contract metadata for all commands or a single command.`,

  doctor: `Usage: remogram doctor [--live] [--json]

Report forge readiness, provider capabilities, and write authority without mutating forge state.`,
});

export function renderCommandHelp(group, sub) {
  if (group === 'doctor' && (sub == null || sub === undefined)) {
    return COMMAND_HELP.doctor;
  }
  if (!group) {
    return `Usage: remogram <group> <subcommand> [flags]

Try command-specific help, for example:
  remogram cr open --help
  remogram issue open --help
  remogram issue view --help
  remogram issue inventory --help
  remogram issue comments --help
  remogram merge execute --help
  remogram verify bind --help
  remogram review bundle --help
  remogram issue bundle --help
  remogram contract --help`;
  }
  const key = sub ? `${group} ${sub}` : group;
  return COMMAND_HELP[key] ?? null;
}
