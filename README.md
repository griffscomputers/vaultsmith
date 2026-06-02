# vaultsmith

Dev-local secret vaulting and supply-chain credential protection for Claude Code.

Vaultsmith is a Claude Code plugin that prevents AI coding agents from accidentally reading plaintext secrets into their context. It migrates credentials from files like `~/.aws/credentials` and `.env` into the OS keychain, blocks the agent from reading those files, and injects secrets at process exec time via a wrapper — so secrets never appear in chat transcripts or tool results.

## How it works

```
Claude Code session
  |
  |-- /vaultsmith:vault-init   (bootstrap vault + permissions)
  |-- /vaultsmith:vault-sweep   (find & migrate plaintext creds)
  |
  |-- Hooks layer
  |     |-- PreToolUse: block Read of secret files
  |     |-- PreToolUse: block Bash reads of secret files
  |
  |-- MCP Server (vaultsmith)
  |     |-- vault_list      (list secret refs, never values)
  |     |-- vault_get_ref   (get vsm:// URI)
  |     |-- vault_set       (store a secret)
  |     |-- vault_resolve   (get plaintext, requires approval)
  |
  |-- vault-run              (exec wrapper: resolves vsm:// env vars)
```

**Trust boundary:** The agent talks to the MCP server, never to the keychain directly. Secret values are opaque `vsm://` references unless the user explicitly approves resolution.

**Allow model (macOS):** Secrets are stored with an empty trusted-applications ACL (`security add-generic-password -T ""`). The OS itself gates every keychain read with a native Keychain Access dialog — there is no custom consent layer. The intended UX is **per-session** approval (similar to Claude Code's "auto" mode): click "Allow" (not "Always Allow") and the resolved value lives in the `vault-session` daemon's memory for the lifetime of that terminal pane (TTY). One prompt per secret per session; closing the pane sends SIGHUP and the daemon zeroes the cache and exits. `vault-lock` (CLI + skill) clears the cache mid-session. Persistent grants are avoided on purpose — they would let same-UID supply-chain malware silently call `security` for the keychain values and defeat the protection. See [docs/aws-keychain-walkthrough.md](docs/aws-keychain-walkthrough.md) for the end-to-end AWS flow.

## Quick start

```bash
# Load the plugin
claude --plugin-dir /path/to/vaultsmith

# Initialize the vault (sets up keychain, patches permissions)
/vaultsmith:vault-init

# Scan and migrate plaintext credentials
/vaultsmith:vault-sweep

# Run commands with secrets injected from the vault
vault-run -- aws s3 ls
```

For the full AWS-on-macOS flow (including the Keychain Access prompt walkthrough and threat model), see [docs/aws-keychain-walkthrough.md](docs/aws-keychain-walkthrough.md).

## What gets protected

| File | Secrets |
|------|---------|
| `~/.aws/credentials` | Access keys, secret keys, session tokens |
| `~/.aws/config` | Credential profiles |
| `.env`, `.env.*` | Database URLs, API keys, tokens |
| `~/.npmrc` | npm auth tokens |
| `~/.docker/config.json` | Registry credentials |
| `~/.netrc`, `~/.git-credentials` | Auth tokens |

After `vault-sweep`, plaintext values are replaced with `vsm://` references:

```ini
# Before
aws_access_key_id = AKIAIOSFODNN7EXAMPLE

# After
aws_access_key_id = vsm://aws/default/access_key_id
```

## Components

### Skills

- **`/vaultsmith:vault-init`** — Detects OS, creates `.vaultsmith/config.json`, tests keychain access, patches `.claude/settings.json` with deny rules, updates `.gitignore`.
- **`/vaultsmith:vault-sweep`** — Scans for plaintext credentials, classifies them, shows a summary, and on confirmation migrates them to the vault with encrypted quarantine backups. Supports `--dry-run`.
- **`/vaultsmith:vault-lock`** — Clears the in-memory session cache (zeroes each running daemon and exits it). Next access to any `vsm://` secret re-prompts via macOS Keychain Access. Supports `--status`.

### Hook scripts

- **`check-read-target`** — PreToolUse hook that blocks the Read tool from accessing secret files.
- **`rewrite-bash`** — PreToolUse hook that blocks Bash commands like `cat ~/.aws/credentials` or `echo $AWS_SECRET_ACCESS_KEY`.

### MCP server

TypeScript server exposing four tools over stdio:

- `vault_list(prefix?)` — List secret names, never values.
- `vault_get_ref(name)` — Get the `vsm://` reference URI for a secret.
- `vault_set(name, value, tags?)` — Store a secret in the OS keychain.
- `vault_resolve(ref, justification)` — Resolve to plaintext. Requires user approval.

### `vault-run` exec wrapper

Shell script that resolves `vsm://` references in environment variables via the OS keychain, then `exec`s the child process. Secrets appear in the spawned process but never in the agent's context. On macOS, resolutions go through the per-TTY `vault-session` daemon so consent is per-session, not per-command.

```bash
export DB_PASSWORD=vsm://db/prod/password
vault-run -- psql -h localhost mydb
```

### `vault-session` daemon + `vault-lock`

A small Node daemon spawned lazily by `vault-run` on macOS. One per controlling TTY (with ancestor-PID fallback when there is no TTY). Holds resolved plaintext in memory only. Exits on:

- SIGHUP (terminal close)
- Anchor TTY device disappearing or anchor PID dying
- 30 minutes idle (hardcoded for v1)
- Explicit `vault-lock` (CLI or `/vaultsmith:vault-lock` skill)

The `bin/rewrite-bash` hook also invokes `vault-lock --all` before allowing suspicious-but-not-blocked patterns (curl/wget piped to a shell, eval-of-fetched-code, base64-to-shell) — these are not blocked outright (legit installers use them) but they trigger forced re-consent.

## Requirements

- macOS or Linux (Windows support planned for v2)
- Node.js 20+
- macOS: Keychain Access (built-in)
- Linux: `libsecret-tools` (`sudo apt install libsecret-tools`) and a keyring daemon

## Project structure

```
vaultsmith/
  .claude-plugin/plugin.json    Plugin manifest
  .mcp.json                     MCP server config
  hooks/hooks.json              Hook definitions
  skills/
    vault-init/SKILL.md         Bootstrap skill
    vault-sweep/SKILL.md        Credential sweep skill
    vault-lock/SKILL.md         Session-cache lock skill
  bin/
    check-read-target           Read hook script
    rewrite-bash                Bash hook script (also locks vault on suspicious patterns)
    vault-run                   Exec wrapper
    vault-resolve               Daemon client used by vault-run
    vault-lock                  CLI to clear session caches
  mcp/
    src/
      server.ts                 MCP entry point
      providers/
        interface.ts            VaultProvider interface
        keychain.ts             OS keychain provider
      tools/
        list.ts                 vault_list
        get-ref.ts              vault_get_ref
        set.ts                  vault_set
        resolve.ts              vault_resolve
      cli/
        socket-path.ts          Shared socket-path / anchor logic
        session-daemon.ts       Per-TTY in-memory cache daemon
        resolve-client.ts       Daemon client used by vault-resolve
        lock-client.ts          Daemon client used by vault-lock
  agents/
    secret-scanner.md           Phase 2 placeholder
```

## Roadmap

- **Phase 1 (current):** Plugin scaffold, MCP server, keychain provider, vault-init, vault-sweep, vault-lock, hooks, vault-run wrapper, per-TTY vault-session daemon, hook-driven lock on suspicious bash patterns.
- **Phase 2:** Infisical provider, gitleaks scanner integration, vault-audit skill, stdout redaction.
- **Phase 3:** vault-rotate (AWS IAM, GitHub PAT, npm tokens), PR automation, OpenBao + 1Password providers.
- **Phase 4:** Team mode with shared Infisical projects and per-developer machine identities.

## License

Apache-2.0
