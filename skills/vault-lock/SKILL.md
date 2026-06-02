---
description: "Clear the in-memory vault-session cache. Forces the next vault-run (or any vault consumer) to re-prompt the user via macOS Keychain Access. Use after sensitive workflows, before invoking untrusted code, or at the user's request."
---

# vault-lock

You are running the `vault-lock` skill for the Vaultsmith Claude Code plugin. This zeros the in-memory cache held by each running `vault-session` daemon and exits the daemons. The next access to any `vsm://` secret will surface a fresh macOS Keychain Access prompt for re-consent.

## When to invoke

- The user finished a sensitive workflow (deployed a release, rotated a credential, finished an AWS task) and asks to lock down.
- The user is about to invoke an untrusted command and you want to force re-consent.
- The user explicitly asks to lock the vault.
- You detected the session is moving to a new "phase" (e.g., from deploy to code review) where the prior cached creds shouldn't apply.

Do NOT invoke this proactively without a clear trigger — it adds friction by forcing the user to re-approve macOS prompts on next use.

## Handle arguments

The user may have passed arguments: `$ARGUMENTS`

- `--status`: Show daemon status only. Do NOT lock.
- (no args, or `--all`): Lock all running daemons for the user.

## Step 1 — Check OS

Run `uname -s`. If the result is not `Darwin`, report:

> "vault-lock applies only on macOS. The Linux libsecret backend does not currently use a session cache."

Then stop.

## Step 2 — Invoke the CLI

For `--status`:

```bash
"${PLUGIN_DIR}/bin/vault-lock" --status
```

For lock (default):

```bash
"${PLUGIN_DIR}/bin/vault-lock" --all
```

Print the wrapper's stdout verbatim to the user.

## Step 3 — Follow-up

After a lock (not after `--status`), add this single line:

```
The vault is locked. Next access to any vsm:// secret will trigger a macOS Keychain Access prompt for re-consent.
```

After `--status`, no follow-up text — the status output speaks for itself.
