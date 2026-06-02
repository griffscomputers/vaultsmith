---
description: "Sweep and migrate plaintext credentials (AWS, .env) into the Vaultsmith vault, replacing originals with vsm:// references."
---

# vault-sweep

You are running the `vault-sweep` skill for the Vaultsmith Claude Code plugin. Follow every step below in order. Do not skip steps. Use the Bash tool for shell commands and the Read/Write/Edit tools for file operations. Use the MCP tools `vault_set`, `vault_get_ref`, and `vault_list` when interacting with the vault.

## Handle arguments

The user may have passed arguments: `$ARGUMENTS`

Supported arguments:
- **`--dry-run`**: Scan and report findings but do NOT migrate or modify any files. Skip Steps 5, 6, and 7.
- **A specific file path**: If the user passes a path (e.g., `~/.aws/credentials` or `.env.staging`), scan ONLY that file instead of the full default scan list.
- No arguments: run the full sweep with migration.

---

## Step 1 — Check prerequisites

1. Check whether `.vaultsmith/config.json` exists in the project root.
2. If it does NOT exist, stop immediately and tell the user:
   > "Vaultsmith has not been initialized in this project. Run `/vaultsmith:vault-init` first to set up the vault."
3. If it exists, read it and confirm the `provider` field is set. Store the provider value for later use.
4. Run `uname -s` to detect the OS. Store it — you will need it for keychain commands and encryption.

---

## Step 2 — Scan for credentials

Scan the following files for plaintext secrets. If the user passed a specific path as an argument, scan only that path.

### Default scan targets

1. **`~/.aws/credentials`** — Look for lines matching:
   - `aws_access_key_id = <value>` (type: `aws_access_key`)
   - `aws_secret_access_key = <value>` (type: `aws_secret_key`)
   - `aws_session_token = <value>` (type: `aws_session_token`)
   - Track which `[profile]` section header each key falls under. If no section header, use `default`.

2. **`~/.aws/config`** — Same key patterns as above. Note: profiles here use `[profile name]` format (except `[default]`). Strip the `profile ` prefix when recording the profile name.

3. **`.env`, `.env.local`, `.env.development`, `.env.production`** and any other `.env.*` files in the project root — Look for lines matching `KEY=VALUE` where:
   - Skip lines starting with `#` (comments).
   - Skip empty lines.
   - Skip keys that are clearly non-secret by convention: keys containing `URL`, `HOST`, `PORT`, `NODE_ENV`, `APP_NAME`, `PUBLIC_`, `NEXT_PUBLIC_`, `REACT_APP_`, `VITE_` (these are typically public config, not secrets).
   - Treat all other `KEY=VALUE` pairs as `generic_env_secret`.
   - If a value is already a `vsm://` reference, skip it — it has already been migrated.

For each secret found, record:
- **type**: one of `aws_access_key`, `aws_secret_key`, `aws_session_token`, `generic_env_secret`
- **location**: full file path and line number
- **profile/context**: the AWS profile name, or the env var name
- **key_name**: the original key name (e.g., `aws_access_key_id`, `DATABASE_URL`)
- **value**: the plaintext secret value (hold in memory only, do not print)

If a file does not exist, skip it silently. If no secrets are found anywhere, report "No plaintext credentials found" and stop.

---

## Step 3 — Classify and summarize findings

Build a summary table of all findings. Display it to the user in this format:

```
Vaultsmith Sweep Results
========================

Found <N> plaintext secret(s) across <M> file(s):

  #  | Type              | File                    | Line | Context/Profile    | Vault Name
  ---|-------------------|-------------------------|------|--------------------|---------------------------
  1  | aws_access_key    | ~/.aws/credentials      | 2    | default            | aws/default/access_key_id
  2  | aws_secret_key    | ~/.aws/credentials      | 3    | default            | aws/default/secret_access_key
  3  | generic_env_secret| .env                    | 1    | DATABASE_URL       | env/DATABASE_URL
  4  | generic_env_secret| .env                    | 2    | STRIPE_SECRET_KEY  | env/STRIPE_SECRET_KEY
```

### Vault name generation rules

- **AWS credentials**: `aws/<profile>/<key_name>` — e.g., `aws/default/access_key_id`, `aws/prod/secret_access_key`, `aws/default/session_token`
- **Env secrets**: `env/<VAR_NAME>` — e.g., `env/DATABASE_URL`, `env/STRIPE_SECRET_KEY`
- If a vault name would collide with an existing key (check with `vault_list`), append a suffix like `_2`.

---

## Step 4 — Request user confirmation

If `--dry-run` was passed, display the summary from Step 3 and stop here with the message:
> "Dry run complete. No changes were made. Run `/vaultsmith:vault-sweep` without `--dry-run` to migrate these secrets."

Otherwise, ask the user for explicit confirmation:

> "Proceed with migrating these <N> secret(s) into the Vaultsmith vault? The original files will be backed up to `.vaultsmith/quarantine/` before modification. (yes/no)"

Do NOT proceed unless the user confirms. If the user says no, stop and report that the sweep was cancelled.

---

## Step 5 — Create quarantine backups

Before modifying ANY original file, create encrypted backups.

1. Create the quarantine directory:
   ```bash
   mkdir -p .vaultsmith/quarantine
   ```

2. Generate a timestamp string for backup naming:
   ```bash
   date -u +"%Y%m%dT%H%M%SZ"
   ```

3. Generate or retrieve the quarantine encryption key:
   - **On macOS**: Check if the key already exists:
     ```bash
     security find-generic-password -a "vaultsmith" -s "vaultsmith/__quarantine_key__" -w 2>/dev/null
     ```
     If it does not exist, generate a new random key and store it:
     ```bash
     QKEY=$(openssl rand -base64 32)
     security add-generic-password -a "vaultsmith" -s "vaultsmith/__quarantine_key__" -w "$QKEY" -U
     ```
   - **On Linux**: Check if the key already exists:
     ```bash
     secret-tool lookup service vaultsmith key "__quarantine_key__" 2>/dev/null
     ```
     If it does not exist, generate and store:
     ```bash
     QKEY=$(openssl rand -base64 32)
     echo -n "$QKEY" | secret-tool store --label="vaultsmith/__quarantine_key__" service vaultsmith key "__quarantine_key__"
     ```

4. For each unique file that will be modified, create an encrypted backup:
   - Compute a safe filename by replacing `/` with `__` and `~` with `HOME` in the path, then append `.<timestamp>.enc`.
   - Example: `~/.aws/credentials` becomes `HOME__.aws__credentials.20260416T120000Z.enc`
   - Example: `.env` becomes `dot_env.20260416T120000Z.enc`
   - Encrypt the file:
     ```bash
     openssl enc -aes-256-cbc -salt -pbkdf2 -in "<original_file>" -out ".vaultsmith/quarantine/<backup_name>" -pass pass:"$QKEY"
     ```
   - Verify the backup file was created and has a non-zero size.

If any backup fails, STOP immediately. Do not modify any files. Report the error to the user.

---

## Step 6 — Migrate secrets to vault

For each secret found in Step 2, in order:

1. **Store in vault**: Call the `vault_set` MCP tool with:
   - `key`: the vault name from Step 3 (e.g., `aws/default/access_key_id`)
   - `value`: the plaintext secret value

2. **Get reference**: Call the `vault_get_ref` MCP tool with:
   - `key`: the same vault name
   - This returns a `vsm://` reference string (e.g., `vsm://aws/default/access_key_id`)

3. **Replace in original file**: Use the Edit tool to replace the plaintext value with the `vsm://` reference:
   - **For AWS credential files** (`~/.aws/credentials`, `~/.aws/config`):
     Replace the value portion only. Example:
     ```
     aws_access_key_id = AKIAIOSFODNN7EXAMPLE
     ```
     becomes:
     ```
     aws_access_key_id = vsm://aws/default/access_key_id
     ```
   - **For .env files**:
     Replace the value portion only. Example:
     ```
     DATABASE_URL=postgres://user:pass@localhost/db
     ```
     becomes:
     ```
     DATABASE_URL=vsm://env/DATABASE_URL
     ```

4. If any `vault_set` call fails, STOP migrating further secrets. Report which secrets were successfully migrated and which failed. The quarantine backups allow the user to restore.

---

## Step 7 — Report results

Print a clear summary:

```
Vaultsmith Sweep Complete
=========================

Migrated: <N> secret(s)
Files modified: <list of files>
Quarantine backups: .vaultsmith/quarantine/

  #  | Vault Key                        | Status
  ---|----------------------------------|--------
  1  | aws/default/access_key_id        | migrated
  2  | aws/default/secret_access_key    | migrated
  3  | env/DATABASE_URL                 | migrated
  4  | env/STRIPE_SECRET_KEY            | migrated

Backups are encrypted in .vaultsmith/quarantine/. To restore a backup:
  1. Retrieve the quarantine key: security find-generic-password -a "vaultsmith" -s "vaultsmith/__quarantine_key__" -w
  2. Decrypt: openssl enc -d -aes-256-cbc -salt -pbkdf2 -in <backup_file> -out <restored_file> -pass pass:<key>

Next steps:
  - Approve each new secret with the macOS Keychain dialog by running
    one interactive command per consumer, e.g.:
      vault-run -- aws sts get-caller-identity
    A Keychain Access dialog will appear for each newly stored secret.
    Click "Allow" — NOT "Always Allow". Per-session consent is the
    intended model: a future vault-session daemon will cache resolved
    values in memory so one prompt per secret per session is enough.
    Persistent grants would defeat protection against supply-chain
    malware that scrapes for plaintext creds. (macOS only — Linux does
    not gate via these mechanics.)
  - Test your workflows with `vault-run` to ensure secrets resolve correctly.
  - Verify your application still starts and connects to services.
  - Once confirmed, you can delete the quarantine backups.
```

Adjust the restoration command for Linux (use `secret-tool lookup` instead of `security find-generic-password`).
