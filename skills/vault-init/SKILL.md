---
description: "Initialize Vaultsmith dev-local secret vault. Bootstraps OS keychain provider, creates config, and patches Claude Code permissions to block plaintext secret reads."
---

# vault-init

You are running the `vault-init` skill for the Vaultsmith Claude Code plugin. Follow every step below in order. Do not skip steps. Use the Bash tool for shell commands and the Read/Write/Edit tools for file operations.

## Handle arguments

The user may have passed arguments: `$ARGUMENTS`

If the user specified a provider other than `keychain`, acknowledge their request but explain that only the `keychain` provider is supported in Phase 1 (macOS Keychain / Linux libsecret). Continue with `keychain` as the provider.

---

## Step 1 — Detect OS

Run `uname -s` to determine the operating system.

- **macOS** (`Darwin`): Continue.
- **Linux**: Continue.
- **Windows / other**: Abort immediately with a clear message: "Vaultsmith requires macOS or Linux. Windows is not supported yet."

Store the detected OS for use in later steps.

---

## Step 2 — Create config directory

Run:

```bash
mkdir -p .vaultsmith
```

This creates the `.vaultsmith/` directory in the project root if it does not already exist.

---

## Step 3 — Write config file

Write `.vaultsmith/config.json` with the following content. Replace `<ISO_TIMESTAMP>` with the current UTC time in ISO 8601 format (generate it via `date -u +"%Y-%m-%dT%H:%M:%SZ"`):

```json
{
  "provider": "keychain",
  "version": "0.1.0",
  "createdAt": "<ISO_TIMESTAMP>",
  "deniedPaths": [
    "~/.aws/credentials",
    "~/.aws/config",
    "~/.npmrc",
    "~/.docker/config.json",
    "~/.netrc",
    "~/.git-credentials",
    ".env",
    ".env.*"
  ]
}
```

---

## Step 4 — Test keychain access

Verify that the OS keychain is accessible by writing, reading, and deleting a test secret.

**On macOS:**

```bash
# Write test secret
security add-generic-password -a "vaultsmith" -s "vaultsmith/__test__" -w "vaultsmith-test-ok" -U

# Read it back
security find-generic-password -a "vaultsmith" -s "vaultsmith/__test__" -w

# Delete it
security delete-generic-password -a "vaultsmith" -s "vaultsmith/__test__"
```

**On Linux:**

```bash
# Write test secret
secret-tool store --label="vaultsmith/__test__" service vaultsmith key "__test__" <<< "vaultsmith-test-ok"

# Read it back
secret-tool lookup service vaultsmith key "__test__"

# Delete it (clear by overwriting with empty, then lookup to confirm)
secret-tool clear service vaultsmith key "__test__"
```

After the read step, verify the value matches `vaultsmith-test-ok`. If any command fails:

- On macOS: tell the user to check Keychain Access permissions and ensure their terminal has "Full Disk Access" or Keychain access in System Settings > Privacy & Security.
- On Linux: tell the user to install `libsecret-tools` (`sudo apt install libsecret-tools`) and ensure a keyring daemon (like `gnome-keyring`) is running.

Do NOT proceed past this step if keychain access fails. Report the error clearly and stop.

---

## Step 5 — Patch Claude Code permissions

Add the denied paths to the project's `.claude/settings.json` so that Claude Code itself is blocked from reading plaintext secret files via the Read tool.

1. Run `mkdir -p .claude` to ensure the directory exists.
2. Read `.claude/settings.json` if it exists. If it does not exist, start with an empty object `{}`.
3. Merge the following into the existing settings, preserving all other keys. Do not overwrite existing `permissions.deny` entries — append to them, deduplicating:

```json
{
  "permissions": {
    "deny": [
      "Read(~/.aws/credentials)",
      "Read(~/.aws/config)",
      "Read(~/.npmrc)",
      "Read(~/.docker/config.json)",
      "Read(~/.netrc)",
      "Read(~/.git-credentials)",
      "Read(.env)",
      "Read(.env.*)"
    ]
  }
}
```

Write the merged result back to `.claude/settings.json`.

---

## Step 6 — Add .vaultsmith/ to .gitignore

Check if `.gitignore` exists in the project root.

- If it exists, read it and check whether `.vaultsmith/` is already listed (as a line by itself). If not present, append a newline and `.vaultsmith/` to the end.
- If it does not exist, create it with `.vaultsmith/` as its only line.

---

## Step 7 — Report results

Print a clear summary to the user:

```
Vaultsmith initialized successfully.

  OS detected:       <macOS or Linux>
  Provider:          keychain
  Config:            .vaultsmith/config.json
  Keychain test:     passed
  Permissions:       .claude/settings.json updated (8 denied paths)
  Gitignore:         .vaultsmith/ added

The vault is ready. Use the Vaultsmith MCP tools to manage secrets:
  - vault_set(key, value)   — store a secret in the OS keychain
  - vault_list()            — list stored secret keys
  - vault_resolve(key)      — retrieve a secret value at runtime
```

Adjust the summary if any paths were already present in settings or gitignore (note that they were already configured rather than newly added).
