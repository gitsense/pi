# Pi Session Memory Analyzer

`session-memory` extracts deterministic review signals from a Pi session log.
It is designed to answer two separate questions:

* What did the agent do?
* What repository context appears to have been available to it?

The builder does not make an LLM call and does not claim that an agent missed
an instruction. It reports observable activity such as bounded reads, command
families, verification order, errors, and elapsed turns.

## Build the session Brain

Run this from the Pi repository:

```bash
.gitsense/bin/build-session-memory \
  --session <pi-session-uuid> \
  --import
```

The builder exports the complete active session branch with:

```text
--head-events 0 --tail-events 0 --capsule-mode compaction-aware
```

It then fully replaces:

```text
$GSC_HOME/data/pi/session-brains/memory-<pi-session-uuid>.db
```

The import is atomic, so rerunning the builder keeps the Brain current as the
session grows. Use `--output /tmp/session-memory.json` without `--import` to
inspect the generated manifest first.

## Configure the export

Request the session-level field with:

```bash
gsc pi sessions export \
  --format gsc-json \
  --uuid <pi-session-uuid> \
  --include-metadata-index \
  --session-metadata 'memory::context'
```

Session metadata appears as one `Session` occurrence in the metadata index. It
is intentionally not copied onto every file operation.

## Metadata items

Items use the session metadata contract:

```json
{
  "group": "Session activity",
  "key": "session-memory:commands:build",
  "title": "Build: npm run build, tsc -b (2)",
  "topics": ["build", "commands", "verification", "typescript"],
  "short_markdown": "The agent ran two TypeScript build commands.",
  "long_markdown": "### Build commands\n\n- `npm run build` — 1 occurrence\n- `tsc -b` — 1 occurrence",
  "markdown": "..."
}
```

The title is the compact signal shown in the metadata list. Topics provide
stable filters. `short_markdown` is used for compact rendering, while
`long_markdown` contains the command, file, timestamp, and evidence details.

The builder currently emits items for:

* build, typecheck, test, lint, and runtime commands;
* partial read coverage;
* edited files with only partial reads before the first edit;
* edited files with no preceding read;
* verification after the final edit;
* tool-result errors; and
* average and longest elapsed turn time.

For TypeScript sessions, recognized command items receive the `typescript`
topic so they can be filtered separately from repository-generic activity.
