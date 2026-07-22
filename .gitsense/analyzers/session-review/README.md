# Pi Session Review Analyzer

`session-review` stores compact Markdown designed to appear beneath Pi file-read, file-edit, and file-write events.

This Pi version combines file purpose from `code-intent` with declarative rules translated from the repository's `AGENTS.md`. It helps a reviewer see what a file is for and which instructions may be worth checking after a change.

The Analyzer is a data contract. Its values are populated by [build-session-review](../../bin/build-session-review), which joins existing metadata without making another LLM call.

## Fields

| Field | Purpose |
| :--- | :--- |
| `read_md` | Shows what the file is for. |
| `edit_md` | Shows the file purpose and reminders whose rules apply to edits. |
| `write_md` | Shows the file purpose and reminders whose rules apply when writing a file. |
| `source_analyzers` | Records whether `code-intent`, `gsc-rules`, or both contributed metadata. |
| `source_fingerprint` | Detects when the source purpose or rules changed. |

## Install

Copy the Analyzer into the GitSense Chat Analyzer directory:

```bash
GSC_ANALYZERS_DIR="${GSC_HOME:?Set GSC_HOME}/data/analyzers"
mkdir -p "$GSC_ANALYZERS_DIR"
cp -R .gitsense/analyzers/session-review "$GSC_ANALYZERS_DIR/"
```

Restart GitSense Chat after installing a new Analyzer.

## Inputs

The builder reads:

* `code-intent` analysis from GitSense Chat
* `.gitsense/rules/records.jsonl` from this repository

Only enabled declarative rules with the `agents-md` topic and an `edit` or `write` action are considered. A rule appears for a file only when its exact file list or glob patterns match that path. Command-only rules do not appear beneath file events.

The source repository and branch must already be imported into GitSense Chat, and `code-intent` analysis must be available there.

## Build and Review

Generate reviewable JSONL without writing analysis:

```bash
.gitsense/bin/build-session-review \
  --output /tmp/pi-session-review.jsonl
```

Validate the import path without writing:

```bash
.gitsense/bin/build-session-review --import --dry-run
```

Populate the Analyzer after reviewing the output:

```bash
.gitsense/bin/build-session-review --import
```

The builder reads the repository and branch from `.gitsense/manifests/code-intent.json` unless they are supplied as flags. It hashes canonical source metadata and skips unchanged records.

## Enrich a Pi Session Export

After packaging or loading the `session-review` results as a Brain:

```bash
gsc pi sessions export \
  --format gsc-json \
  --metadata 'read::session-review::read_md' \
  --metadata 'edit::session-review::edit_md' \
  --metadata 'write::session-review::write_md' \
  --include-insights
```

The Markdown shows which reminders apply. It does not prove that the agent followed them. Use the surrounding session events and the generated `pi-rules-insights` message to check what happened next.
