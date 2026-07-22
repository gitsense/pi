# Instructions Session Review Analyzer

`instructions-session-review` stores classified review items showing which repository instructions apply to Pi file-read, file-edit, and file-write events.

This Pi version combines file purpose from `code-intent` with declarative rules translated from the repository's `AGENTS.md`. Each item has a group, stable key, short title, and Markdown detail, allowing a metadata index to group matching reminders without parsing their presentation text.

The Analyzer is a data contract. Its values are populated by [build-instructions-session-review](../../bin/build-instructions-session-review), which joins existing metadata without making another LLM call.

## Fields

| Field | Purpose |
| :--- | :--- |
| `read_items` | Classified file-context items showing what a read brought into context. |
| `edit_items` | File context plus independently reviewable reminders that apply to edits. |
| `write_items` | File context plus independently reviewable reminders that apply to writes. |
| `source_analyzers` | Records whether `code-intent`, `gsc-rules`, or both contributed metadata. |
| `source_fingerprint` | Detects when the source purpose or rules changed. |

Every item contains:

```json
{
  "group": "AGENTS.md reminders",
  "key": "agents-md:rule_019f8718-edb5",
  "title": "Run the repository check after code changes",
  "markdown": "### What to remember\n\n- Run `npm run check` with full output."
}
```

## Install

Copy the Analyzer into the GitSense Chat Analyzer directory:

```bash
GSC_ANALYZERS_DIR="${GSC_HOME:?Set GSC_HOME}/data/analyzers"
mkdir -p "$GSC_ANALYZERS_DIR"
cp -R .gitsense/analyzers/instructions-session-review "$GSC_ANALYZERS_DIR/"
```

Restart GitSense Chat after installing a new Analyzer.

## Inputs

The builder reads:

* `code-intent` analysis from GitSense Chat
* Repository-scoped `agents-md` rules through `gsc rules list`

The builder calls `gsc rules list --scope repo --topic agents-md --format json`; it does not read GitSense's rule storage directly. Only enabled declarative rules with an `edit` or `write` action are considered. A rule appears for a file only when its exact file list or glob patterns match that path. Command-only rules do not appear beneath file events.

The source repository and branch must already be imported into GitSense Chat, and `code-intent` analysis must be available there.

## Build and Review

Generate reviewable JSONL without writing analysis:

```bash
.gitsense/bin/build-instructions-session-review \
  --output /tmp/pi-instructions-session-review.jsonl
```

Validate the import path without writing:

```bash
.gitsense/bin/build-instructions-session-review --import --dry-run
```

Populate the Analyzer after reviewing the output:

```bash
.gitsense/bin/build-instructions-session-review --import
```

The builder reads the repository and branch from `.gitsense/manifests/code-intent.json` unless they are supplied as flags. It hashes canonical source metadata and skips unchanged records.

## Enrich a Pi Session Export

After packaging or loading the `instructions-session-review` results as a Brain:

```bash
gsc pi sessions export \
  --format gsc-json \
  --metadata 'read::instructions-session-review::read_items' \
  --metadata 'edit::instructions-session-review::edit_items' \
  --metadata 'write::instructions-session-review::write_items' \
  --include-insights
```

The structured items show which reminders matched. They do not prove that the agent followed them. Use the surrounding session events and the generated `pi-rules-insights` message to check what happened next.
