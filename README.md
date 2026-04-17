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

Shell script that resolves `vsm://` references in environment variables via the OS keychain, then `exec`s the child process. Secrets appear in the spawned process but never in the agent's context.

```bash
export DB_PASSWORD=vsm://db/prod/password
vault-run -- psql -h localhost mydb
```

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
  bin/
    check-read-target           Read hook script
    rewrite-bash                Bash hook script
    vault-run                   Exec wrapper
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
  agents/
    secret-scanner.md           Phase 2 placeholder
```

## Roadmap

- **Phase 1 (current):** Plugin scaffold, MCP server, keychain provider, vault-init, vault-sweep, hooks, vault-run wrapper.
- **Phase 2:** Infisical provider, gitleaks scanner integration, vault-audit skill, stdout redaction.
- **Phase 3:** vault-rotate (AWS IAM, GitHub PAT, npm tokens), PR automation, OpenBao + 1Password providers.
- **Phase 4:** Team mode with shared Infisical projects and per-developer machine identities.

## License

Apache-2.0
