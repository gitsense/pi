# Pi Session Memory Analyzer

`session-memory` extracts deterministic review signals from a Pi session log.
It is designed to answer two separate questions:

* What did the agent do?
* What repository context appears to have been available to it?

The builder does not make an LLM call and does not claim that an agent missed
an instruction. It reports observable activity such as bounded reads, command
families, verification order, errors, and elapsed turns.

## Build the session Brain

When this analyzer is installed in the session repository, the Chat backend
automatically runs the standard `.gitsense/bin/build-session-memory` builder
when a configured session Brain is missing or stale. Users normally only need
to configure `session::<brain>::<field>` in Chat.

If the analyzer is installed in a different repository, register the builder
once so Chat can discover it for sessions from any repository:

```bash
gsc pi sessions brains register \
  --brain memory \
  --builder "$HOME/pi/.gitsense/bin/build-session-memory"
```

This is a one-time analyzer registration, not a per-session bootstrap.

To remove the registration later without deleting existing session Brains:

```bash
gsc pi sessions brains unregister --brain memory
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
.gitsense/bin/build-session-memory \
  --session <pi-session-uuid> \
  --import
```

The builder can be called on every refresh. It asks `gsc` for the cheap current
session revision, uses a per-session lock, and skips the export/import when the
revision and builder version have not changed:

```bash
.gitsense/bin/build-session-memory \
  --session <pi-session-uuid> \
  --import
```

To pass a revision already obtained by `gsc`, use:

```bash
REVISION="$(gsc pi sessions revision --uuid <pi-session-uuid> | jq -r .revision)"
.gitsense/bin/build-session-memory \
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
$GSC_HOME/data/pi/session-brains/memory-<pi-session-uuid>.db
```

The import is atomic, so rerunning the builder keeps the Brain current as the
session grows. Use `--output /tmp/session-memory.json` without `--import` to
inspect the generated manifest first.

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
  --session-metadata 'session::memory::context'
```

Session metadata appears as one `Session` occurrence in the metadata index. It
is intentionally not copied onto every file operation. The canonical selector
is `session::<brain>::<field>`; for example:

```bash
gsc pi sessions export \
  --format gsc-json \
  --uuid <pi-session-uuid> \
  --include-metadata-index \
  --session-metadata 'session::memory::context'
```

The logical Brain name (`memory`) is combined with the session UUID by `gsc`:

```text
$GSC_HOME/data/pi/session-brains/memory-<pi-session-uuid>.db
```

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

The manifest records the Brain scope and builder path. The registration above
stores the same builder contract globally under `$GSC_HOME/data/pi`, so
`gsc pi sessions brains show --session <uuid> --brain memory --format json`
can discover it before the first session import. A session-specific descriptor
created by `--import` takes precedence. The environment variable below remains
a compatibility fallback for older backends.

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

## Chat app refresh hook

To have older Pi Chat backends refresh session metadata before each initial
load and poll, configure the builder path in its environment:

```bash
export GSC_PI_SESSION_METADATA_BUILDER="$HOME/pi/.gitsense/bin/build-session-memory"
```

When session metadata is configured, the backend asks `gsc pi sessions
revision` for the cheap current revision, then invokes the builder once for
each requested Brain. The builder lock and revision state make unchanged polls
cheap while still rebuilding after the session log changes.
