# AGENTS.md Catch Analyzer

`agents-md` turns repository-authored `AGENTS.md` guidance into file-aware
review metadata. It does not replace `AGENTS.md` or claim that the agent
violated an instruction. It shows which instructions should be checked when a
matching file is read, edited, or written.

The values are populated deterministically by
[build-agents-md](../../bin/build-agents-md). The builder reads the repository's
file-scoped `agents-md` rules and makes no additional LLM call.

## Fields

| Field | Purpose |
| :--- | :--- |
| `catch` | Operation-neutral AGENTS.md review catches matched to the file. |
| `source_analyzers` | Identifies the deterministic source, currently `gsc-rules`. |
| `source_fingerprint` | Detects when the matching rules changed. |

Each `catch` item uses the session metadata contract:

```json
{
  "group": "AGENTS.md catches",
  "key": "catch:rule_019f8718-edb5-72f3-af88-9179f5a47cbb",
  "title": "Remind contributors to run the repository check after code changes",
  "topics": ["testing", "verification"],
  "keywords": ["modified-test", "verification"],
  "short_markdown": "Check: Remind contributors to run the repository check after code changes.",
  "long_markdown": "### AGENTS.md instruction\n\nRun the repository check after code changes...",
  "markdown": "### AGENTS.md instruction\n\nRun the repository check after code changes..."
}
```

`short_markdown` is authored for compact session views. `long_markdown` is the
complete explanation with the instruction, why the file matched, importance,
and stable rule ID. `markdown` remains an alias for `long_markdown` for current
consumers.

`topics` and `keywords` are optional compact descriptors copied from the rule.
They let a reviewer understand what kind of instruction matched without
displaying the full rule text.

## What can be caught

The builder attaches enabled declarative rules with file selectors. In this
repository that includes deterministic reminders for:

* running `npm run check` after source or test changes;
* running modified tests and using the faux provider harness;
* using the required regression-test naming convention;
* preserving erasable TypeScript syntax and top-level imports;
* updating generated model sources through their generator;
* following dependency, lockfile, and shrinkwrap review rules;
* keeping changelog edits in the Unreleased section; and
* keeping keybindings configurable.

Command-only rules, such as blocking an unsafe `npm test` invocation, do not
have a file path to attach to and are therefore not emitted by this analyzer.
They remain useful as runtime rules. This distinction prevents the metadata
from implying that a file match proves what the agent did.

## Install

Copy the analyzer into the GitSense Chat Analyzer directory:

```bash
GSC_ANALYZERS_DIR="${GSC_HOME:?Set GSC_HOME}/data/analyzers"
mkdir -p "$GSC_ANALYZERS_DIR"
cp -R .gitsense/analyzers/agents-md "$GSC_ANALYZERS_DIR/"
```

## Build and Review

Generate reviewable JSONL without importing it:

```bash
.gitsense/bin/build-agents-md \
  --output /tmp/pi-agents-md.jsonl
```

Validate the import path without writing analysis:

```bash
.gitsense/bin/build-agents-md --import --dry-run
```

Populate the `agents-md` analyzer after reviewing the JSONL:

```bash
.gitsense/bin/build-agents-md --import
```

The builder uses `gsc rules list --scope repo --topic agents-md --format json`.
It uses the existing `code-intent` manifest only to resolve repository context
for the GitSense Chat analysis command; it does not read or require code-intent
records. Only enabled declarative rules with an `edit` or `write` action and a
matching file selector are emitted.

## Enrich a Pi Session

Configure the session metadata field as:

```text
read,write,edit::agents-md::catch
```

This shows the AGENTS.md catches that apply to files touched by the agent. A
catch is a review prompt, not a finding or proof that the agent missed the
instruction.
