# Session Activity Review Analyzer

`session-activity-review` is a deterministic, agent-neutral Session Analyzer.
It turns a normalized GitSense session export into a few authored Markdown
tabs that help a reviewer decide what to inspect next.

It is designed to answer:

* What observable activity took place?
* Is there a useful pattern to review before spending time on the code?
* What bounded evidence could be handed to another AI for a pattern review?

It does not decide whether the code is correct and it does not claim that an
agent saw or followed a repository instruction.

## Session Analyzer contract

Normal execution reads one JSON request from stdin and writes one JSON response
to stdout. Diagnostics go to stderr. The builder never reads a native Pi log
directly. `gsc` supplies a normalized session descriptor and an executable
export command in the request.

Run the builder through the registered analyzer command:

```bash
gsc pi sessions analyzers run \
  --analyzer activity-review < request.json
```

The builder invokes the request's `export.executable` with `export.args`
directly, without a shell. This lets the same analyzer work with any agent
adapter that produces the GitSense normalized session format.

The response owns its tabs. The current analyzer returns:

| Tab | Purpose |
| --- | --- |
| Overview | Compact counts and observed elapsed activity. |
| Activity | Detailed deterministic signals and evidence. |
| Handoff | A bounded Markdown package for asking another AI to review session patterns. |

The analyzer can return `status: "cached"`, but cached responses contain the
complete presentation and all tabs. A cache hit is not an `unchanged` response
with missing content.

## Register the analyzer

Register the executable once on the machine where GitSense Chat runs:

```bash
gsc pi sessions analyzers register \
  --analyzer activity-review \
  --builder "$HOME/pi/.gitsense/bin/build-session-activity-review" \
  --description "Observable Pi session activity and review signals"
```

Inspect registration:

```bash
gsc pi sessions analyzers list
gsc pi sessions analyzers show --analyzer activity-review --format json
```

Remove the registration without changing analyzer output already cached by a
caller:

```bash
gsc pi sessions analyzers unregister --analyzer activity-review
```

Registration is stored under `$GSC_HOME/data/pi/session-analyzers`. The
analyzer itself caches complete responses under the same Pi data directory.
The cache identity includes the builder version, session descriptor, revision,
review boundary, export command, and requested tabs. The builder takes a
per-cache lock so concurrent refreshes do not run the same export twice.

## Request shape

The request has `protocol_version: "1.0"` and includes a normalized session
descriptor, an optional review range, and the export command:

```json
{
  "protocol_version": "1.0",
  "session": {
    "session_id": "019f...",
    "revision": "v1:current...",
    "name": "Implement a feature",
    "cwd": "/Users/terrchen/pi",
    "repo_root": "/Users/terrchen/pi",
    "provider": "provider-name",
    "model": "model-name",
    "message_count": 305,
    "tool_call_count": 155,
    "file_ref_count": 36,
    "source": {
      "kind": "pi",
      "session_file": "/path/to/session.jsonl",
      "session_file_exists": true
    }
  },
  "range": {
    "revision": "v1:current...",
    "since_revision": "v1:reviewed...",
    "reviewed_from_entry_id": "optional-boundary"
  },
  "export": {
    "executable": "gsc",
    "args": [
      "pi", "sessions", "export", "--format", "gsc-json",
      "--uuid", "019f...", "--head-events", "0", "--tail-events", "0",
      "--capsule-mode", "compaction-aware"
    ]
  }
}
```

`since_revision` is a cache identity. The builder may use
`reviewed_from_entry_id` to scope its analysis, but a revision string alone is
not assumed to be a historical event boundary. The export command must carry
any actual range flags needed by a builder.

## Response shape

```json
{
  "protocol_version": "1.0",
  "status": "success",
  "analyzer": {
    "id": "session-activity-review",
    "version": "12"
  },
  "session_id": "019f...",
  "range": {
    "revision": "v1:current...",
    "since_revision": "v1:reviewed..."
  },
  "presentation": {
    "label": "Activity review",
    "blurb": "Observable signals from this Pi session."
  },
  "tabs": [
    {
      "id": "report",
      "label": "Overview",
      "default": true,
      "markdown": "# Session activity\n\n...",
      "copy_label": "Copy overview"
    },
    {
      "id": "signals",
      "label": "Activity",
      "markdown": "# Activity\n\n...",
      "copy_label": "Copy activity"
    },
    {
      "id": "handoff",
      "label": "Handoff",
      "markdown": "# Pattern review handoff\n\n...",
      "copy_label": "Copy handoff"
    }
  ]
}
```

The UI should use the returned presentation and tab labels rather than
assuming that every analyzer has `report`, `signals`, or `handoff` fields.

## Deterministic signals

The Activity tab currently extracts:

* conversation messages using user and assistant messages, excluding tool
  calls and tool results from the conversation count;
* reads, edits, writes, and Bash commands;
* partial read coverage and edited files without a preceding read;
* build, typecheck, test, lint, and runtime command families;
* Git rename activity, including chained `git mv`, edit, and verification
  commands;
* verification after the final edit;
* tool-result errors; and
* average and longest observed elapsed turn time.

Observed elapsed time includes model processing and pauses between events. It
is not tool execution time. These are review signals, not correctness claims.

The Activity Markdown keeps the full explanation and evidence. For example, a
command signal can include the command, its occurrence count, status, and
bounded output details. The Handoff tab is deliberately bounded to roughly
10,000 tokens and is builder-defined. It is intended to be copied when a
reviewer wants another AI to comment on session patterns after several minutes
of work.

## Development and self-test

Run syntax checks and deterministic parser tests from this repository:

```bash
node --check .gitsense/bin/build-session-activity-review
.gitsense/bin/build-session-activity-review --self-test
```

Normal execution no longer accepts `--session`, `--brain`, `--revision`, or
`--import`. Those values are part of the stdin request and response contract.
