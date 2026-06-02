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
# Write test secret with empty trusted-apps ACL (-T "") so reads are gated by
# the native Keychain Access prompt. The user WILL see one dialog on the
# read-back below — click "Allow" (NOT "Always Allow"). Per-session consent is
# the intended model; persistent grants would defeat protection against
# supply-chain scrapers that just shell to `security`.
security add-generic-password -a "vaultsmith" -s "vaultsmith/__test__" -w "vaultsmith-test-ok" -T "" -U

# Read it back (this will trigger a Keychain Access prompt the first time)
security find-generic-password -a "vaultsmith" -s "vaultsmith/__test__" -w

# Delete it
security delete-generic-password -a "vaultsmith" -s "vaultsmith/__test__"
```

If the user sees the Keychain Access dialog and the read returns `vaultsmith-test-ok` after they approve, the prompt-gated flow is working as intended — this is the same dialog they'll see for real AWS / `.env` secrets later.

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

## Step 7 — Detect and offer to upgrade pre-ACL entries (macOS only)

If the OS is macOS, check whether the user already has `vaultsmith`-service entries in the keychain from a prior install. Items stored before the `-T ""` ACL was introduced will silently resolve forever, defeating the prompt-based "allow" model.

1. List existing entries:

   ```bash
   security dump-keychain 2>/dev/null | awk -F\" '/"svce"<blob>="vaultsmith"/{getline; if ($0 ~ /"acct"<blob>=/) print $2}'
   ```

2. If the list is empty, skip the rest of this step.

3. If entries exist, print them to the user and ask:

   > "Found <N> existing vault entries that may pre-date the prompt-based ACL. Re-store them with the new ACL? Each entry will produce one Keychain Access prompt next time it is accessed. (yes/no)"

4. On confirmation, for each entry, read the value, delete the item, then re-add it with `-T ""`:

   ```bash
   for n in $(security dump-keychain 2>/dev/null | awk -F\" '/"svce"<blob>="vaultsmith"/{getline; if ($0 ~ /"acct"<blob>=/) print $2}'); do
     v=$(security find-generic-password -s vaultsmith -a "$n" -w) || continue
     security delete-generic-password -s vaultsmith -a "$n" >/dev/null
     security add-generic-password -s vaultsmith -a "$n" -w "$v" -T "" -U
   done
   ```

5. Each read in the loop above will surface a Keychain Access prompt for entries that were previously stored without `-T ""`. That's expected — the user is approving the read so the value can be re-stored with the new ACL.

Skip this step on Linux — `secret-tool` does not have the same ACL semantics, and entries do not need to be re-stored.

---

## Step 8 — Report results

Print a clear summary to the user:

```
Vaultsmith initialized successfully.

  OS detected:       <macOS or Linux>
  Provider:          keychain
  Config:            .vaultsmith/config.json
  Keychain test:     passed
  Permissions:       .claude/settings.json updated (8 denied paths)
  Gitignore:         .vaultsmith/ added
  ACL upgrade:       <N entries re-stored | no pre-ACL entries found | skipped (Linux)>

The vault is ready. Use the Vaultsmith MCP tools to manage secrets:
  - vault_set(key, value)   — store a secret in the OS keychain
  - vault_list()            — list stored secret keys
  - vault_resolve(key)      — retrieve a secret value at runtime

macOS allow model: secrets are stored with an empty trusted-apps ACL.
Every access surfaces a Keychain Access dialog — pick "Allow" (NOT "Always
Allow"). Per-session consent is the intended model: a future vault-session
daemon will cache resolved values in memory so you only see one prompt per
secret per terminal session. Persistent grants are avoided on purpose. See
docs/aws-keychain-walkthrough.md for the full end-to-end flow.
```

Adjust the summary if any paths were already present in settings or gitignore (note that they were already configured rather than newly added).
