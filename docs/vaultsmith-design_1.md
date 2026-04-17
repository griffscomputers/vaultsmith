# Vaultsmith — Design Document

**Status:** Draft v0.1 — handoff to Claude Code
**License:** Apache-2.0 (intended)
**Target:** Claude Code plugin (skills + hooks + MCP) for dev-local secret vaulting and supply-chain credential protection

---

## 1. Problem statement

Developers using AI coding agents (Claude Code, Cursor, Codex) routinely expose long-lived credentials — `~/.aws/credentials`, `.env` files, `~/.npmrc` tokens, GitHub PATs, Stripe keys — to:

1. **The agent's read context** (chat history, transcripts, telemetry).
2. **Process execution** (the agent runs `npm install`, `terraform apply`, tests — secrets resolve and become observable to the agent at runtime).
3. **Compromised dependencies** (recent npm/PyPI worms have specifically targeted these credential locations).

Existing mitigations are partial:

- `.claudeignore` / `permissions.deny` blocks file reads but **not runtime resolution**.
- Vault references (`op://...`) protect at rest but secrets still resolve into the agent's process tree at exec time.
- Standalone vaults (Vault, Infisical, 1Password) require manual setup, manual migration, and manual discipline.
- Existing Claude skills (`secret-vault`, `claude-vault`, `secret-scanner`) are lightweight single-purpose helpers, not an integrated workflow.

**Vaultsmith closes the gap** by shipping an opinionated, dev-local, agent-aware vaulting workflow as a single Claude Code plugin.

---

## 2. Goals

| # | Goal | Success metric |
|---|------|---------------|
| G1 | One-command bootstrap of a local vault from inside Claude Code | `/vault init` → working vault in <2 min |
| G2 | Agentic sweep that finds and migrates existing plaintext credentials | Migrates ≥95% of common credential locations (AWS, npm, GitHub, Docker, .env) |
| G3 | Block plaintext secret reads via Claude Code permission rules | Zero `.env`/`~/.aws` reads in transcript after install |
| G4 | Inject secrets at process exec time, not in chat context | Secrets appear in spawned process env, never in tool_result blocks |
| G5 | Continuous agentic scanner on edits and pre-commit | Catches OWASP-top secret patterns + entropy hits |
| G6 | Auto-rotate detected leaked credentials | Provider API rotation + git history rewrite + PR opened |

## 3. Non-goals (v1)

- Replacing enterprise secrets platforms (Vault, CyberArk).
- Production secret distribution (CI/CD, Kubernetes operators).
- Multi-tenant team sync — start single-developer, add team mode in v2.
- Windows-first support — macOS + Linux first; Windows in v2.
- Custom secret detection rules — wrap `gitleaks` and Infisical's built-in scanner instead of building from scratch.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code session                                         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ /vault   │  │ /vault   │  │ /vault   │  │ scanner     │ │
│  │ init     │  │ sweep    │  │ rotate   │  │ subagent    │ │
│  │ (skill)  │  │ (skill)  │  │ (skill)  │  │ (PostTool)  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │             │             │                │        │
│  ┌────▼─────────────▼─────────────▼────────────────▼─────┐ │
│  │  Hooks layer (PreToolUse / PostToolUse / PreCompact) │ │
│  │   • Block reads of denied paths                      │ │
│  │   • Rewrite Bash to vault-run wrapper                │ │
│  │   • Run scanner on file edits                        │ │
│  └────┬─────────────────────────────────────────────────┘ │
└───────┼─────────────────────────────────────────────────────┘
        │
        │ MCP (stdio)
        ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│ Vaultsmith MCP       │────▶│ VaultProvider interface       │
│ • get / set / list   │     │  ├─ Infisical (default)       │
│ • scan               │     │  ├─ OS keychain (lite mode)   │
│ • migrate            │     │  ├─ OpenBao                   │
│ • rotate             │     │  ├─ 1Password CLI             │
└──────────────────────┘     │  └─ AWS Secrets Manager       │
                              └──────────────────────────────┘
        │
        ▼
┌──────────────────────┐
│ vault-run            │   process wrapper:
│ (exec injector)      │   resolves vsm://... → env vars
└──────────────────────┘   at spawn time, not via chat
```

### Trust boundary

The agent talks to the **MCP server**, never to the underlying vault directly. The MCP server enforces:

- Read-only access by default for `get` operations on production-tagged secrets.
- Write access requires explicit user confirmation via `ask_user_input`.
- Secret values returned to the agent are **opaque references** (`vsm://aws/dev/access_key`) unless the user explicitly requests resolution.

---

## 5. Component breakdown

### 5.1 Plugin manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "vaultsmith",
  "version": "0.1.0",
  "description": "Dev-local secret vaulting for Claude Code",
  "author": "<your handle>",
  "license": "Apache-2.0",
  "skills": [
    "skills/vault-init",
    "skills/vault-sweep",
    "skills/vault-rotate",
    "skills/vault-audit"
  ],
  "agents": ["agents/secret-scanner.md"],
  "hooks": "hooks/hooks.json",
  "mcpServers": {
    "vaultsmith": {
      "command": "vaultsmith-mcp",
      "args": ["--config", "${CLAUDE_PROJECT_DIR}/.vaultsmith/config.json"]
    }
  }
}
```

### 5.2 Skills

| Skill | Trigger | Behavior |
|-------|---------|----------|
| `vault-init` | `/vault init` | Detect provider preference (keychain | infisical | openbao). Bootstrap. Write `.vaultsmith/config.json`. Patch `.claude/settings.json` with deny rules. Install `vault-run` shim into `.vaultsmith/bin/`. |
| `vault-sweep` | `/vault sweep` | Walk `~/.aws/`, `~/.npmrc`, `~/.docker/config.json`, `.env*`, `~/.netrc`, `~/.git-credentials`. Classify findings. Show diff. On confirm: write to vault, replace files with reference stubs, add originals to `.vaultsmith/quarantine/` (encrypted). |
| `vault-rotate` | `/vault rotate <ref>` or auto on leak detection | Provider-specific rotation playbook (AWS IAM, GitHub PAT, npm token). Update vault. Open PR if refs in repo. |
| `vault-audit` | `/vault audit` | Run gitleaks + Infisical scanner against repo + git history. Report findings, propose rotation. |

### 5.3 Hooks (`hooks/hooks.json`)

Per Claude Code's hook spec:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": ".vaultsmith/bin/rewrite-bash"
        }
      ]
    },
    {
      "matcher": "Read",
      "hooks": [
        {
          "type": "command",
          "command": ".vaultsmith/bin/check-read-target"
        }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": ".vaultsmith/bin/scan-edit"
        }
      ]
    }
  ]
}
```

`rewrite-bash` inspects the command and, if it matches `aws *`, `gh *`, `terraform *`, `npm publish`, etc., wraps it in `vault-run --` so secrets are injected by the wrapper rather than read into the agent's context.

### 5.4 MCP server (`vaultsmith-mcp`)

**Language:** TypeScript (matches Claude Code ecosystem; easy `npx` distribution).
**Tools exposed:**

- `vault_list(prefix?)` → list refs only, never values
- `vault_get_ref(name)` → returns `vsm://...` reference string
- `vault_resolve(ref, justification)` → returns plaintext (requires user approval via elicitation)
- `vault_set(name, value, tags?)` → store new secret
- `vault_scan(path)` → run scanner subprocess, return findings
- `vault_migrate(source_path, target_ref)` → move plaintext into vault, replace source with stub

**Auth:** MCP server reads `.vaultsmith/config.json` for provider credentials (machine identity for Infisical, OS keychain access for lite mode). Provider creds are themselves stored in OS keychain — never in plaintext config.

### 5.5 `vault-run` exec wrapper

Small Go or Rust binary (single static binary, no runtime deps).

```bash
vault-run -- aws s3 ls
# 1. Parse env for vsm:// references
# 2. Resolve via local Unix socket to vaultsmith-mcp
# 3. Spawn child with resolved env
# 4. Stream stdout/stderr — but redact any value matching a known secret
# 5. On exit, zero the env in memory
```

### 5.6 Scanner subagent (`agents/secret-scanner.md`)

A Claude Code subagent invoked by the `PostToolUse` hook. Wraps:

- **gitleaks** (MIT) for fast regex+entropy scan
- **Infisical scanner** (140+ secret types per Infisical docs)
- LLM contextual review for ambiguous high-entropy strings

Returns structured findings: `{file, line, type, confidence, suggested_action}`.

---

## 6. Tech stack & dependencies

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Default vault provider | **Infisical** (self-host via Docker) | MIT-licensed, official MCP server already exists, 140+ scanner rules built in |
| Lite vault provider | **OS keychain** (macOS Keychain, libsecret) | Zero-dep mode for solo devs |
| Alt enterprise provider | **OpenBao** (MPL-2.0) | True OSS Vault fork for shops avoiding HashiCorp BSL |
| MCP server runtime | TypeScript / Node 20+ | `@modelcontextprotocol/sdk` is first-class TS |
| Exec wrapper | Go (or Rust) | Static binary, fast startup, no runtime |
| Scanner | gitleaks + Infisical scanner | Don't reinvent detection rules |
| Plugin distribution | Claude Code plugin marketplace | Standard install path |

---

## 7. Threat model

| Threat | Mitigation |
|--------|-----------|
| Agent reads plaintext `.env` into transcript | `permissions.deny` rules + Read hook check |
| Agent runs `cat ~/.aws/credentials` via Bash | Bash PreToolUse hook blocks read of denied paths |
| Agent runs test suite, secrets resolve into process env, agent observes via stdout | `vault-run` wrapper + stdout redaction filter |
| Compromised npm package exfiltrates `~/.aws/credentials` | Sweep moves credentials out of standard locations into vault; original paths contain stubs |
| MCP server itself is compromised (malicious plugin) | Vaultsmith MCP runs as user, has no network egress by default; provider creds in OS keychain not config file |
| Leaked secret in git history | `vault-audit` scans history; `vault-rotate` rewrites history + rotates upstream |
| Agent is socially engineered to call `vault_resolve` | Resolution requires user elicitation approval per call; logged to audit trail |

**Out of scope:** kernel-level attacks, compromised OS keychain, attacker with sudo.

---

## 8. Implementation phases

### Phase 1 — MVP (target: 2 weeks)
- [ ] Plugin scaffold + manifest
- [ ] `vault-init` skill (OS keychain provider only)
- [ ] `vault-sweep` skill (AWS + .env only)
- [ ] `permissions.deny` patching
- [ ] `vault-run` wrapper for `aws` and `gh` CLIs
- [ ] Basic MCP server with `get_ref` / `set` / `list`

### Phase 2 — Scanner & Infisical
- [ ] Infisical provider
- [ ] PostToolUse scanner hook wrapping gitleaks
- [ ] `vault-audit` skill with git history scan
- [ ] Stdout redaction in `vault-run`

### Phase 3 — Rotation & polish
- [ ] `vault-rotate` for AWS IAM + GitHub PAT + npm tokens
- [ ] PR-opening automation
- [ ] OpenBao + 1Password providers
- [ ] Marketplace submission

### Phase 4 — Team mode (deferred)
- [ ] Shared Infisical project bootstrap
- [ ] Per-developer machine identities
- [ ] Audit log shipping

---

## 9. Repo structure

```
vaultsmith/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   ├── vault-init/SKILL.md
│   ├── vault-sweep/SKILL.md
│   ├── vault-rotate/SKILL.md
│   └── vault-audit/SKILL.md
├── agents/
│   └── secret-scanner.md
├── hooks/
│   ├── hooks.json
│   └── scripts/
│       ├── rewrite-bash
│       ├── check-read-target
│       └── scan-edit
├── mcp/
│   ├── package.json
│   ├── src/
│   │   ├── server.ts
│   │   ├── providers/
│   │   │   ├── keychain.ts
│   │   │   ├── infisical.ts
│   │   │   └── openbao.ts
│   │   └── tools/
│   └── tsconfig.json
├── exec-wrapper/
│   ├── go.mod
│   └── main.go
├── tests/
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   └── providers/
├── LICENSE          # Apache-2.0
├── README.md
└── CONTRIBUTING.md
```

---

## 10. Open questions for the build

1. **Default behavior on `vault_resolve`:** always require user approval, or allow a per-session "trusted" mode? (Lean: always require — fail closed.)
2. **Stdout redaction performance:** streaming regex match on every byte could be slow. Buffer per-line? Risk: secrets that span line breaks.
3. **Windows support timeline:** ship v1 macOS/Linux only and document, or block release until parity?
4. **Telemetry:** opt-in usage metrics for improving detection rules, or zero telemetry on principle? (CISO lens: zero telemetry by default.)
5. **Conflict with Anthropic native vaults API:** if Anthropic ships first-class secrets in Claude Code (per issue #29910), pivot Vaultsmith to focus on the scanner + rotation layer that they're unlikely to ship.

---

## 11. References for the build agent

- Claude Code plugin system: `https://code.claude.com/docs/en/plugins`
- Claude Code hooks reference: `https://code.claude.com/docs/en/hooks`
- Claude Code settings (permissions, sandbox): `https://code.claude.com/docs/en/settings`
- Infisical MCP server: `https://github.com/Infisical/infisical-mcp-server` (verify path on first fetch)
- Infisical self-host: `https://github.com/Infisical/infisical`
- OpenBao: `https://github.com/openbao/openbao`
- gitleaks: `https://github.com/gitleaks/gitleaks`
- Anthropic Claude Code issue #29910 (secrets management spec): `https://github.com/anthropics/claude-code/issues/29910`
- Trail of Bits hardened Claude Code config (reference patterns): `https://github.com/trailofbits/claude-code-config`
- Hannecke, "Your Vault Protects Your Secrets — Until Claude Code Runs Your Tests" (runtime leak threat model)

---

## 12. Handoff notes for Claude Code

When picking this up:

1. Start by reading this doc end-to-end, then propose a Phase 1 implementation plan back to me before writing code.
2. Verify every URL in §11 with `web_fetch` before relying on API shapes — versions move.
3. Build in this order: plugin scaffold → MCP server skeleton → keychain provider → `vault-init` skill → wrapper binary → `vault-sweep`. Test each layer in isolation.
4. Use `ralph-loop` style: implement Phase 1 narrowly, run end-to-end, get my review, then iterate.
5. Apache-2.0 headers on every source file.
6. No telemetry, no network calls outside the configured vault provider, ever.
