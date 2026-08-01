# Pi Session Activity Review Analyzer

`session-activity-review` extracts deterministic review signals from observable
activity in a Pi session log. It is designed to answer two questions:

* What did the agent do?
* What observable activity should be verified before reviewing the code?

The Brain exposes three views of the same session. `report` is a compact
Markdown overview for the default view. `signals` is the structured detail
view for filtering and drilling into commands, reads, verification, and other
session activity. `handoff` is a builder-defined Markdown package that can be
copied to another AI for a pattern review.

The builder does not make an LLM call and does not claim that an agent missed
an instruction or retained particular knowledge. It reports bounded reads,
command families, verification order, errors, and elapsed turns.

## Build the session Brain

Register the builder once so Chat can discover it for sessions from any
repository:

```bash
gsc pi sessions brains register \
  --brain activity-review \
  --builder "$HOME/pi/.gitsense/bin/build-session-activity-review"
```

This is a one-time analyzer registration, not a per-session bootstrap.

To remove the registration later without deleting existing session Brains:

```bash
gsc pi sessions brains unregister --brain activity-review
```

List registered session Brain builders with:

```bash
gsc pi sessions brains list
```

Run the builder manually when developing or troubleshooting the analyzer. The
initial `--import` creates the session Brain and records its builder descriptor;
after that, the backend can discover and refresh the builder automatically.

Run this from the Pi repository:

```bash
.gitsense/bin/build-session-activity-review \
  --session <pi-session-uuid> \
  --import
```

The builder can be called on every refresh. It asks `gsc` for the cheap current
session revision, uses a per-session lock, and skips the export/import when the
revision and builder version have not changed:

```bash
.gitsense/bin/build-session-activity-review \
  --session <pi-session-uuid> \
  --import
```

To pass a revision already obtained by `gsc`, use:

```bash
REVISION="$(gsc pi sessions revision --uuid <pi-session-uuid> | jq -r .revision)"
.gitsense/bin/build-session-activity-review \
  --session <pi-session-uuid> \
  --revision "$REVISION" \
  --import
```

An unchanged invocation returns `status: unchanged`. The processed revision is
stored beside the session Brain under `$GSC_HOME/data/pi/session-brains/.state`.

The builder exports the complete active session branch with:

```text
--head-events 0 --tail-events 0 --capsule-mode compaction-aware
```

It then fully replaces:

```text
$GSC_HOME/data/pi/session-brains/activity-review-<pi-session-uuid>.db
```

The import is atomic, so rerunning the builder keeps the Brain current as the
session grows. Use `--output /tmp/session-activity-review.json` without
`--import` to inspect the generated manifest first.

`gsc pi sessions revision` is a fast check based on the synchronized session
file metadata and counters; it does not walk or export the session message
tree.

## Configure the export

Request the session-level field with:

```bash
gsc pi sessions export \
  --format gsc-json \
  --uuid <pi-session-uuid> \
  --include-metadata-index \
  --session-metadata 'session::activity-review::report' \
  --session-metadata 'session::activity-review::signals' \
  --session-metadata 'session::activity-review::handoff'
```

Session metadata appears as one `Session` occurrence in the metadata index. It
is intentionally not copied onto every file operation. The canonical selector
is `session::<brain>::<field>`; for example:

```bash
gsc pi sessions export \
  --format gsc-json \
  --uuid <pi-session-uuid> \
  --include-metadata-index \
  --session-metadata 'session::activity-review::report' \
  --session-metadata 'session::activity-review::signals' \
  --session-metadata 'session::activity-review::handoff'
```

The logical Brain name (`activity-review`) is combined with the session UUID by `gsc`:

```text
$GSC_HOME/data/pi/session-brains/activity-review-<pi-session-uuid>.db
```

## Session report

The `report` field contains one session-level report item. Its Markdown is
intentionally factual and compact so a reviewer can orient themselves before
opening the structured details. It includes conversation counts, tool-call and
file counts, command categories, and observed elapsed activity such as:

```markdown
# Session activity

4 conversation messages · 2 turns · 155 tool calls · 36 files referenced

## Observed elapsed activity

- Reads: 6m observed across 33 reads
- Edits and writes: 4m observed across 12 file changes
- Bash commands: 11m observed across 46 commands

Observed elapsed time includes model processing and pauses between events. It
is not tool execution time.
```

The report does not declare that a session is ready for review. It gives the
reviewer enough context to decide whether to inspect the detailed signals or
go directly to the changed code.

The report field is defined as:

```json
{
  "name": "report",
  "display_name": "Session activity report",
  "type": "array",
  "review_context": {
    "label": "Session report",
    "item_singular": "session report",
    "item_plural": "session reports"
  },
  "presentation": {
    "kind": "report",
    "format": "markdown",
    "default": true,
    "drilldown_field": "signals"
  }
}
```

## Pattern review handoff

The `handoff` field is one structured item whose `markdown` value is owned by
the builder. The builder decides which evidence and reference material to
include. This analyzer includes the task, session scale, phase sequence,
progress signals, anomalies, repeated command patterns, tool statuses, and
short output excerpts for commands that failed or were repeated.

The builder keeps the handoff bounded to approximately 10,000 tokens. Routine
successful commands are summarized, while suspicious commands retain their
arguments and useful output excerpts. The handoff asks another AI to review
observable session patterns, not to determine whether the code is correct.

The field is defined as:

```json
{
  "name": "handoff",
  "display_name": "Pattern review handoff",
  "type": "array",
  "review_context": {
    "label": "Pattern review handoff",
    "item_singular": "pattern review handoff",
    "item_plural": "pattern review handoffs"
  },
  "presentation": {
    "kind": "handoff",
    "format": "markdown",
    "copyable": true,
    "copy_label": "Copy handoff"
  }
}
```

The item uses one canonical content property. It does not use
`short_markdown` or `long_markdown`:

```json
{
  "group": "Session handoff",
  "key": "session-activity-review:handoff",
  "title": "Pattern review handoff",
  "markdown": "# Pattern review handoff\n..."
}
```

## Review signals

Items use the session metadata contract:

```json
{
  "group": "Session activity",
  "key": "session-activity-review:commands:build",
  "title": "Build: npm run build, tsc -b (2)",
  "topics": ["build", "commands", "verification", "typescript"],
  "short_markdown": "The agent ran two TypeScript build commands.",
  "long_markdown": "### Build commands\n\n- `npm run build` — 1 occurrence\n- `tsc -b` — 1 occurrence",
  "markdown": "..."
}
```

The `signals` field is a structured review field, so its manifest definition
also includes a required descriptor:

```json
{
  "name": "signals",
  "display_name": "Session activity",
  "type": "array",
  "review_context": {
    "label": "Review signals",
    "item_singular": "review signal",
    "item_plural": "review signals"
  }
}
```

The builder validates this descriptor before writing the manifest. Consumers
can use it to render counts such as `7 review signals matched` without
guessing what the field contains.

The title is the compact signal shown in the metadata list. Topics provide
stable filters. `short_markdown` is used for compact rendering, while
`long_markdown` contains the command, file, timestamp, and evidence details.

The manifest records the Brain scope and builder path. The registration above
stores the same builder contract globally under `$GSC_HOME/data/pi`, so
`gsc pi sessions brains show --session <uuid> --brain activity-review --format json`
can discover it before the first session import. A session-specific descriptor
created by `--import` takes precedence. The environment variable below remains
a compatibility fallback for older backends.

The builder currently emits report data and signal items for:

* build, typecheck, test, lint, and runtime commands;
* partial read coverage;
* edited files with only partial reads before the first edit;
* edited files with no preceding read;
* verification after the final edit;
* tool-result errors; and
* average and longest observed elapsed turn time.

For TypeScript sessions, recognized command items receive the `typescript`
topic so they can be filtered separately from other session activity.

## Chat app refresh hook

To have older Pi Chat backends refresh session metadata before each initial
load and poll, configure the builder path in its environment:

```bash
export GSC_PI_SESSION_METADATA_BUILDER="$HOME/pi/.gitsense/bin/build-session-activity-review"
```

When session metadata is configured, the backend asks `gsc pi sessions
revision` for the cheap current revision, then invokes the builder once for
each requested Brain. The builder lock and revision state make unchanged polls
cheap while still rebuilding after the session log changes.
