# AWS credentials in the macOS Keychain — end-to-end walkthrough

This guide walks a developer through enabling vaultsmith for AWS credentials on macOS. The goal: get `~/.aws/credentials` (or your `.env`) to hold only `vsm://` reference strings, store the real values in the macOS Keychain, and let the OS itself gate every access via the native Keychain Access prompt — with **per-session** consent, not persistent grants.

> **Why per-session, not "Always Allow"?**
> The threat vaultsmith is designed against is supply-chain malware that scrapes well-known credential paths (`.env`, `~/.aws/credentials`, etc.) for plaintext. If you click "Always Allow" once, any same-UID process on your machine — including a malicious npm postinstall script or a compromised IDE extension — can silently call `security find-generic-password` for that item forever after. That defeats the protection. Click "Allow" instead. The cost is one dialog per secret per terminal session; the win is that a fresh session forces a re-prompt and a hostile process running while you're away has no path to the value.

## What you get

```ini
# Before
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# After
[default]
aws_access_key_id = vsm://aws/default/access_key_id
aws_secret_access_key = vsm://aws/default/secret_access_key
```

Then:

```bash
$ vault-run -- aws sts get-caller-identity
# macOS dialog (one per secret used by this command):
#   "vault-run wants to use your confidential information stored in
#    'aws/default/access_key_id' in your keychain."
# Click "Allow" — NOT "Always Allow".
{
    "UserId": "AIDAIOSFODNN7EXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/you"
}
```

You'll see one prompt per secret per terminal session. `vault-run` resolves through the `vault-session` daemon, which holds resolved values in memory for the lifetime of the controlling TTY. Close the terminal pane (SIGHUP) or run `vault-lock` to clear the cache and force re-consent on the next access. Claude Code never sees the plaintext — it's blocked from reading the file (the hook) and only sees `vsm://` strings if it lists secrets via the MCP.

## Prerequisites

- macOS (this guide is macOS-specific; Linux has similar mechanics via `libsecret` but no per-item prompt).
- Node.js 20+.
- Vaultsmith plugin installed (see `README.md` for plugin load).
- An existing `~/.aws/credentials` file with at least a `[default]` profile. If you don't have one, `aws configure` creates it.
- The AWS CLI installed and on `$PATH` (only needed for the verification step).

## Step 1 — One-time setup

Inside a Claude Code session in the project where you want to use vaultsmith:

```
/vaultsmith:vault-init
```

This:

1. Detects macOS.
2. Creates `.vaultsmith/config.json` and adds `.vaultsmith/` to `.gitignore`.
3. Writes a test secret to the Keychain (you will see ONE Keychain Access prompt — click "Allow"; the test secret is deleted immediately after). This proves the prompt-gated flow works.
4. Patches `.claude/settings.json` with deny rules so Claude can't Read the secret files via its built-in tools.
5. If you've used vaultsmith before this version, detects pre-ACL keychain entries and offers to re-store them with the new prompt-based ACL.

## Step 2 — Migrate AWS credentials into the keychain

```
/vaultsmith:vault-sweep
```

This:

1. Scans `~/.aws/credentials`, `~/.aws/config`, and any `.env*` files in the project root for plaintext secrets.
2. Shows you a table of findings and the vault names it will use (`aws/default/access_key_id`, `aws/default/secret_access_key`, etc.).
3. Asks for confirmation (`yes`/`no`). Type `yes`.
4. Creates encrypted backups of each modified file under `.vaultsmith/quarantine/`.
5. Stores each secret in the Keychain via the MCP server's `vault_set` tool (this uses `security add-generic-password -T "" -U` under the hood — the `-T ""` is what creates the empty ACL that forces the prompt on reads).
6. Replaces the plaintext value in each source file with a `vsm://` reference.

After this completes, `cat ~/.aws/credentials` should show only `vsm://aws/default/*` references — the plaintext is gone from disk.

## Step 3 — Prove it works

Run a real AWS call through `vault-run`:

```bash
vault-run -- aws sts get-caller-identity
```

What happens:

1. `vault-run` walks `env` and finds variables whose value starts with `vsm://`. (If you migrated `~/.aws/credentials`, the AWS CLI itself will read the file directly — but for `.env`-based setups, the env vars get resolved here.)
2. For each `vsm://` reference, `vault-run` shells to `security find-generic-password -s vaultsmith -a <name> -w`.
3. macOS surfaces a Keychain Access dialog for each secret. The dialog says something like:

   > **vault-run wants to use your confidential information stored in "aws/default/access_key_id" in your keychain.**
   > [Always Allow]  [Deny]  [Allow]

   Pick **Allow** — not "Always Allow." Persistent grants would let same-UID malware (e.g., a malicious npm postinstall script) silently call `security` and read the keychain value forever after, which defeats the supply-chain protection that's the whole point of vaultsmith.

   Pick **Deny** to refuse — the command will fail with an empty value, which is the correct behavior if you didn't initiate the command.

4. `vault-run` exports the resolved values into the child process's environment, then `exec`s the AWS CLI. The AWS CLI sees real credentials, calls STS, and returns the identity. The `vault-session` daemon (started lazily on first `vault-run`) keeps the resolved values in memory for the rest of the session.

Re-run the same command in the same terminal pane: no prompts. The cache hit is silent.

Open a fresh terminal pane and re-run: fresh prompts. Different TTY, different daemon, no shared cache.

### AWS CLI vs `.env` flows

There are two common shapes for this depending on how your app consumes AWS creds:

| Source                   | What vault-sweep does                                          | How AWS code reads it                                                              |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `~/.aws/credentials`     | Replaces values with `vsm://aws/<profile>/...` inside the file | The AWS SDK reads the file. **You need a small shim** (see below) to resolve refs. |
| `.env` with `AWS_*` vars | Replaces values with `vsm://env/AWS_*` inside `.env`           | Your app loads `.env`; `vault-run` resolves the env vars at exec time. ✅ Just works |

For the `.env` flow, the picture is complete: `vault-run -- node app.js` (or `vault-run -- your-cli`) gets resolved env vars and the app sees real values.

For the `~/.aws/credentials` flow, the AWS SDK reads the file directly and sees the `vsm://` strings as literal — which it cannot use. The recommended path is to **stop using `~/.aws/credentials`** and instead set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` env vars to `vsm://...` strings and always run AWS commands through `vault-run`. This trades global SDK behavior for explicit per-command resolution, which is the whole point.

A minimal `.env.aws` to source instead of `~/.aws/credentials`:

```bash
export AWS_ACCESS_KEY_ID=vsm://aws/default/access_key_id
export AWS_SECRET_ACCESS_KEY=vsm://aws/default/secret_access_key
# Optional, if your profile uses session tokens:
# export AWS_SESSION_TOKEN=vsm://aws/default/session_token
```

Then:

```bash
source .env.aws
vault-run -- aws sts get-caller-identity
```

## Step 4 — Daily use

```bash
vault-run -- aws s3 ls
vault-run -- terraform plan
vault-run -- pulumi up
vault-run -- node scripts/seed-db.js
```

The pattern is always `vault-run -- <your command>`. The first command in a session triggers prompts; subsequent commands in the same terminal pane hit the daemon's cache and resolve silently. Sub-agents (Claude `Task` tool, nested Bash calls) inherit the same TTY and share the cache without extra prompts.

## Locking the vault mid-session

You don't need to close the terminal to clear the cache. Run:

```bash
vault-lock              # Clear the daemon for this terminal pane
vault-lock --all        # Clear every running daemon for your user
vault-lock --status     # Show running daemons (anchor, cached count, idle time)
```

From inside a Claude session, invoke the skill:

```
/vaultsmith:vault-lock           # locks all
/vaultsmith:vault-lock --status  # show only
```

When to lock:

- Walking away from the laptop for any length of time.
- Switching from a trusted workflow (e.g. deploy) to an untrusted one (e.g. running a third-party install script).
- After Claude finishes a sensitive task — ask it to "lock the vault before we continue."
- The `rewrite-bash` hook also auto-locks before letting Claude run commands matching suspicious patterns (curl-to-shell, eval-of-fetched-code, base64-to-shell). You don't have to remember; it happens automatically. The command itself is not blocked — just preceded by a lock so any secret access inside it re-prompts.

## MCP vs CLI — which path resolves the secret

Both, with different consumers:

- **`vault-run` (shell-side)** — used by humans and CI/scripts. Shells directly to `security`. Plaintext lands in the spawned child process's environment, never in any Claude conversation.
- **MCP tools (agent-side)** — used by Claude inside a session. `vault_list` and `vault_get_ref` give Claude *references*, never values. `vault_resolve` returns plaintext, but because the underlying Keychain ACL is empty, macOS itself surfaces a prompt before returning the value to the MCP server. You decide whether to allow.

The agent never sees plaintext unless you explicitly choose to allow it via the Keychain prompt.

## Threat model

The primary threat vaultsmith is designed against: supply-chain malware (malicious npm postinstall, compromised IDE extension, etc.) that scrapes well-known credential paths for plaintext.

What this DOES protect against:

- **Supply-chain file scrapers.** `~/.aws/credentials` and `.env` contain only `vsm://` reference strings. A scraper that reads these files gets useless data.
- **Agent-context exposure.** Claude is blocked from Reading the secret files by the PreToolUse hook, and `vault_get_ref` returns only references. Plaintext does not appear in chat transcripts, MCP results, or hook output.
- **Background processes calling `security`.** Because each item has an empty trusted-apps ACL, any `security find-generic-password -s vaultsmith` call surfaces a visible Keychain Access dialog. A hostile process running while you're away cannot silently extract the value — the prompt fires and stays until you click.
- **Session boundaries.** Per-session consent (Allow, not Always Allow) means closing your terminal / logging out forces re-prompts. There is no persistent grant for an attacker to inherit.
- **Cross-user attacks on shared workstations.** The login keychain is per-user.

What this does NOT protect against:

- **Active in-process exfiltration during a prompt.** If you click Allow while malware is racing to call `security` for the same item, the grant covers that one call. Mitigation: only click Allow when you initiated the command.
- **Memory inspection of `vault-run` or its child** while the resolved value is in process memory. Mitigation: keep TTL low (no daemon yet; current model exits as soon as the child exits).
- **A malicious child of `vault-run`** — you `exec`d it with the resolved env, so it gets the value by design.
- **A user who clicks "Always Allow" by accident.** macOS makes it easy. If this happens, see the troubleshooting section below to revoke the grant.

The "Allow" grant is keyed to the calling process invocation of `/usr/bin/security`, not to a code-signed bundle ID. Proper per-binary gating requires a signed Mach-O / `.app`, which `vault-run` is not. This is a known limitation of CLI access to the Keychain. Per-session consent + the empty ACL is the best the unsigned-CLI path gives us; it's a meaningful raise in attacker cost without being a true sandbox.

## Troubleshooting

### "No Keychain prompt appears, even on first use"

You likely have a pre-ACL keychain entry from an older vaultsmith install. `security add-generic-password -U` updates the value of an existing item but **preserves** the existing (broader) ACL. Run `/vaultsmith:vault-init` again — the new Step 7 detects and offers to re-store entries with the prompt-gated ACL. Or run the manual one-liner:

```bash
for n in $(security dump-keychain 2>/dev/null | awk -F\" '/"svce"<blob>="vaultsmith"/{getline; if ($0 ~ /"acct"<blob>=/) print $2}'); do
  v=$(security find-generic-password -s vaultsmith -a "$n" -w) || continue
  security delete-generic-password -s vaultsmith -a "$n" >/dev/null
  security add-generic-password -s vaultsmith -a "$n" -w "$v" -T "" -U
done
```

The first read in this loop will itself prompt for any entry that previously had broad ACLs — that's the user approving the read so the value can be re-stored under the new ACL.

### "I clicked Deny by accident — now the command fails forever"

Reset the ACL by deleting and re-storing the secret:

```bash
# Replace <name> with e.g. aws/default/access_key_id
v=$(security find-generic-password -s vaultsmith -a <name> -w)  # may itself prompt
security delete-generic-password -s vaultsmith -a <name>
security add-generic-password -s vaultsmith -a <name> -w "$v" -T "" -U
```

If you can't read the value back because of the Deny, you'll need to restore from the encrypted quarantine backup in `.vaultsmith/quarantine/` — see the `vault-sweep` Step 7 output for the decrypt one-liner.

### "I clicked Always Allow by accident — how do I revoke?"

Open Keychain Access.app, find the `vaultsmith` entry for the affected account, double-click → Access Control tab → remove `/usr/bin/security` from the trusted list, save. Or just delete and re-add the item via the one-liner above. The next access will prompt again.

### "I want to inspect what's in the vault"

```bash
# List all vaultsmith entries (names only, not values)
security dump-keychain 2>/dev/null | awk -F\" '/"svce"<blob>="vaultsmith"/{getline; if ($0 ~ /"acct"<blob>=/) print $2}'

# Or via the MCP (in a Claude session):
# /mcp call vaultsmith vault_list
```

### "I want to wipe the vault"

```bash
for n in $(security dump-keychain 2>/dev/null | awk -F\" '/"svce"<blob>="vaultsmith"/{getline; if ($0 ~ /"acct"<blob>=/) print $2}'); do
  security delete-generic-password -s vaultsmith -a "$n"
done
```

This deletes only `vaultsmith`-service items. Other keychain entries (Wi-Fi passwords, Safari saved logins, etc.) are untouched.

## Why "MCP or CLI" was the right question

You asked whether you'd need an MCP or a CLI for the credential call. The answer the project already encodes: **both, but for different callers**. The MCP is for Claude inside the session; the CLI is for the shell and for child processes. Neither path is the "consent" surface — that role belongs to macOS Keychain itself. By storing items with `-T ""`, the OS handles the allow/deny prompt natively, so vaultsmith doesn't need a bespoke consent UI in either the MCP or the wrapper. The wrapper just shells to `security` and macOS does the rest.
