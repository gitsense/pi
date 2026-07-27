# Plan: Define the GSC Pi Edit-History Recorder Contract

## Context and end goal

GitSense Chat should let a user open a Pi `edit` or `write` event and see:

1. The exact file bytes before the operation.
2. The exact file bytes after the operation.
3. A rendered diff between those states.
4. The assistant thinking and visible message that led to the tool call.
5. The tool arguments, result, session, entry, and file provenance.

The intended user workflow is:

```text
/brains rules recorder personal
        |
        v
gsc pi rules recorder install
        |
        v
Pi edit/write calls are captured for that session, across repositories
        |
        v
GitSense Chat renders edit events, thinking, results, and exact diffs
```

The recorder will be implemented in `gsc-cli`. Pi Brains will later provide
the interactive installer, while `gsc pi sessions` will later retrieve and
export recorder data. This plan defines the contract those later components
must share. It does not implement the recorder, rules, installer, or UI.

The recorder rule pack is personal-only. It is not a repository rule and must
not be installed with a repository target. The executable rule definitions and
trigger assets use GSC's normal personal-rule location (`~/.gitsense` in the
current CLI); the captured runtime data is stored separately and exclusively
under `$GSC_HOME/data/pi/edit-history/`.

## Scope of this step

Define and approve the v1 contract for:

- Recorder event records.
- Git blob identity and storage semantics.
- Pre-tool and post-tool lifecycle behavior.
- Session and tool-call correlation.
- File operation and failure semantics.
- Recorder CLI boundaries.
- Compatibility with `$GSC_HOME/data/pi/pi-sessions.sqlite3`.

Out of scope:

- Creating the executable rules.
- Adding `/brains rules recorder`.
- Modifying Pi Brains.
- Adding SQLite tables or changing `gsc pi sessions gsc-json`.
- Rendering diffs in GitSense Chat.
- Tracking arbitrary shell commands such as formatters.

## Proposed v1 architecture

```text
Pi pre_tool_use event
        |
        v
gsc-pi-edit-history-pre rule
        |
        v
gsc recorder: snapshot current bytes as a Git blob
        |
        v
Pi executes edit/write
        |
        v
Pi post_tool_use event
        |
        v
gsc-pi-edit-history-post rule
        |
        v
gsc recorder: snapshot actual resulting bytes and append event
```

The recorder uses Git as content-addressed byte storage, not as a commit
history in v1. The authoritative event journal is JSONL. A later version may
add trees and commits without changing existing blob IDs.

Recommended personal storage:

```text
${GSC_HOME}/data/pi/edit-history/<session-id>/
├── recorder.json      # format and session metadata
├── objects.git/       # bare Git object database containing blobs
├── edits.jsonl        # completed recorder events
└── pending/           # pre-tool state awaiting post-tool completion
```

There is one rule and storage scope in v1: personal GSC scope. The recorder is
partitioned by Pi session, not by repository. A session may edit files in
multiple repositories or outside Git entirely, so repository membership is
metadata rather than a storage boundary.

The scope boundary is explicit:

```text
Personal rule definitions/triggers: ~/.gitsense/rules/...
Personal recorder runtime data:      $GSC_HOME/data/pi/edit-history/<session-id>/
Repository rule installation:        unsupported
Repository recorder data:            unsupported
```

## Proposed event schema

Use a versioned, flat JSONL record so it can be streamed, indexed, and
consumed by both Go and JavaScript clients.

```json
{
  "version": 1,
  "eventId": "edit-e9d95c78551a...",
  "journalSequence": 42,
  "sessionId": "019f9e31-a16c-79d8-ad08-ffa7a5c568e2",
  "assistantEntryId": "b5550212",
  "toolCallId": "call_a1fce8eb80254e4684108750",
  "startedAt": "2026-07-27T03:03:52.912Z",
  "completedAt": "2026-07-27T03:03:53.175Z",
  "repoRoot": "/Users/terrchen/gitsense-chat",
  "path": "/Users/terrchen/gitsense-chat/packages/chat/widgets/app/components/pi/handlers/PiStateHandler.js",
  "relativePath": "packages/chat/widgets/app/components/pi/handlers/PiStateHandler.js",
  "operation": "modify",
  "recordingStatus": "complete",
  "toolStatus": "success",
  "beforeBlob": "f4f32d606bd7280edc66f4739a5c8cc1b83d9223",
  "afterBlob": "a97e7e5a6d885ec98a847466056f60e8108127c1",
  "beforeSize": 4312,
  "afterSize": 4478,
  "beforeMode": "100644",
  "afterMode": "100644",
  "toolError": null,
  "recorderError": null
}
```

Required fields:

- `version`: record schema version.
- `eventId`: deterministic, path-safe ID derived from
  `sha256(sessionId + "\\0" + toolCallId)`.
- `journalSequence`: monotonically increasing append order within one session
  journal; it is not Pi conversation order.
- `sessionId`: Pi session UUID; must equal `pi_chats.uuid`.
- `assistantEntryId`: assistant message entry that initiated the tool call.
- `toolCallId`: exact Pi tool invocation; the primary event correlation key.
- `startedAt`: RFC3339 timestamp when the before-state was captured.
- `completedAt`: RFC3339 timestamp when the after-state was observed, or
  `null` for an incomplete event.
- `repoRoot`: Git repository containing the edited file, or `null` when the
  target is outside Git.
- `path`: normalized absolute target path. This is the primary file identity
  because a session may edit outside its starting repository.
- `relativePath`: repository-relative path using `/` separators when
  `repoRoot` is non-null; otherwise `null`.
- `operation`: `add`, `modify`, `delete`, or `noop`.
- `recordingStatus`: `complete`, `pending`, `partial`, or `failed`.
- `toolStatus`: `success`, `failed`, `cancelled`, or `unknown`.
- `beforeBlob`: Git blob ID or `null`.
- `afterBlob`: Git blob ID or `null`.
- `toolError`: tool-reported error or `null`.
- `recorderError`: recorder error or `null`.

Recommended optional fields:

- `durationMs`: derived duration between `startedAt` and `completedAt`.
- `beforeSize` and `afterSize`: exact byte sizes.
- `beforeMode` and `afterMode`: file modes when available.
- `ruleId` and `ruleHash`: provenance for the rule that captured the event.

Do not use `pi_rule_events.event_id` as `eventId`; that table identifies rule
evaluation telemetry, not file-revision events.

## Identifier and database contract

The recorder must preserve enough metadata to join with the existing Pi
session mirror at `$GSC_HOME/data/pi/pi-sessions.sqlite3`.

```text
recorder.sessionId  -> pi_chats.uuid
recorder.assistantEntryId -> pi_messages.entry_id / pi_tool_calls.entry_id
recorder.toolCallId -> pi_tool_calls.tool_call_id / pi_file_refs.tool_call_id
recorder.path       -> pi_file_refs.abs_path
recorder.relativePath -> pi_file_refs.file_path_rel
recorder.repoRoot   -> pi_file_refs.repo_root when available
```

`sessionId + toolCallId` is the exact lookup key. `assistantEntryId` is required for
message provenance but is not sufficient by itself because one assistant entry
may contain multiple tool calls.

The event identity invariant is `UNIQUE(sessionId, toolCallId)`. Pre- and
post-tool handlers independently derive the same `eventId`, making retries and
crash recovery idempotent.

The recorder must not depend on the SQLite integer `chat_id` as its durable
identifier. That ID is an internal mirror key and may change when the mirror is
rebuilt.

## Lifecycle semantics

### Before `edit` or `write`

The pre-tool rule must:

1. Resolve and normalize the target path against the Pi session cwd. Do not
   require it to be inside the session's starting repository.
2. Determine whether the path exists.
3. Read the exact bytes without text normalization.
4. Store existing bytes with `git hash-object -w` in `objects.git`.
5. Create a pending record keyed by `eventId` or `sessionId + toolCallId`.
6. Allow the Pi tool call only after the pending state is durable.

If the file does not exist, `beforeBlob` is `null`. If the snapshot cannot be
stored, the pre-tool operation must fail closed so the edit is not allowed to
proceed without a before-state.

### After `edit` or `write`

The post-tool rule must:

1. Locate the pending record using `sessionId + toolCallId`.
2. Read the actual bytes currently on disk; never use the requested replacement
   as the after-state.
3. Store those bytes as the after blob, or use `null` if the path was deleted.
4. Derive `operation` only from before/after existence and blob equality.
5. Copy the tool result status and error into the record independently.
6. Create retention refs for every captured blob.
7. Append exactly one completed JSONL event and flush it.
8. Remove or mark the pending record as completed.

The post-tool handler must run for both successful and failed tool results.

### Failure cases

Expected cases must be represented explicitly:

- Failed replacement with unchanged file: `operation: "noop"`,
  `toolStatus: "failed"`, and equal before/after blob IDs.
- Added file: `beforeBlob: null`.
- Deleted file: `afterBlob: null`.
- No-op edit: `operation: "noop"`.
- Partial change followed by tool failure: `operation: "modify"` and
  `toolStatus: "failed"`.
- Crash between pre and post: durable pending record remains for recovery.
- Recorder failure before the tool call: block the tool call.
- Recorder failure after the tool call: retain pending state and surface a
  visible error; set `recordingStatus: "partial"` rather than interpreting a
  missing after blob as deletion.

## Recorder CLI contract

The rules should be thin adapters. Blob, locking, JSONL, and recovery logic
should live in `gsc-cli`, not be duplicated in trigger JavaScript.

The exact names are subject to review, but the initial API should cover:

```text
gsc pi sessions recorder record-before --context <trigger-context.json>
gsc pi sessions recorder record-after --context <trigger-context.json>
gsc pi sessions recorder list --session <session-id>
gsc pi sessions recorder show --session <session-id> --tool-call <tool-call-id>
gsc pi sessions recorder diff --session <session-id> --tool-call <tool-call-id>
```

The recorder rule installer should always target personal scope and should not
expose a `--target repo` option:

```text
gsc pi rules recorder install
gsc pi rules recorder status
gsc pi rules recorder remove
```

The `record-before` and `record-after` commands should accept the standard
Pi/GitSense trigger context so the rules do not need to translate identifiers
or tool input independently.

The read commands should support machine-readable JSON output in addition to a
human format. `diff` should resolve blobs from the session recorder directory
selected by `sessionId`, not from a repository-local recorder.

The recorder must use one fixed Git object format for the lifetime of a
session recorder. V1 should explicitly select SHA-1 and record that choice in
`recorder.json`:

```json
{
  "version": 1,
  "gitObjectFormat": "sha1"
}
```

## Concurrency and durability requirements

The contract must define these behaviors before implementation:

- Serialize sequence allocation and JSONL append operations per session
  journal.
- Make pending writes atomic, preferably by writing a temporary file and
  renaming it into place.
- Ensure every referenced blob is written before its completed event is
  appended.
- Create reachability refs for captured blobs before appending a completed
  event:

  ```text
  refs/gitsense/recorder/<event-id>/before
  refs/gitsense/recorder/<event-id>/after
  ```

  Omit a ref when the corresponding blob is `null`.
- Permit unreferenced blobs after a crash; they are harmless.
- Keep recorder storage outside the edited workspaces.
- Validate target paths before filesystem access, but do not reject a valid Pi
  file operation solely because it is outside the session's starting repo.
- Preserve binary files and line endings exactly.
- Never rely on Git's default reachability rules alone. Recorder-referenced
  blobs must remain reachable through recorder refs. Cleanup may delete refs
  only through a recorder-aware command, followed by explicit Git maintenance.

## Security and privacy requirements

The recorder stores source-file contents, potentially including secrets. The
contract must document that:

- Recorder data is personal and stored under `$GSC_HOME`; it does not need to
  be ignored by each project’s regular Git history.
- Personal installation affects all files touched by the Pi session, including
  files in other repositories or outside Git.
- The Chat App must not expose recorder contents beyond the session/repository
  permissions already applied to the user.
- Recorder paths and tool arguments must be validated before filesystem access.
- No network access is required for recording or blob retrieval.

The contract must explicitly define symlink behavior. V1 should reject
symlink targets that resolve outside the allowed filesystem target, while still
allowing edits outside the session's starting repository. Supported regular
file modes are `100644`, `100755`, and `120000`; other special filesystem
objects may be rejected.

## Acceptance criteria for step 1

The contract is ready for implementation when:

- A reviewer can identify the exact record for any native Pi `edit` or `write`
  tool call using `sessionId + toolCallId`.
- The record can be joined to assistant thinking through the Pi session mirror.
- Added, modified, deleted, no-op, and failed operations have unambiguous
  representations.
- The before and after states are defined as exact bytes, not text patches.
- The event ordering and crash-recovery behavior are explicit.
- Personal rule scope and session-local storage scope are unambiguous.
- Blob retention refs and the pinned Git object format are explicit.
- The recorder CLI boundary is clear enough for the two official triggers to
  be implemented without duplicating storage logic.
- A future `gsc pi sessions recorder diff` command can be implemented without
  changing the v1 event schema.

## Reviewer decisions requested

Please review and decide:

1. Should the default personal installation use strict capture, or should it
   default to best-effort with an explicit recording-gap event?
2. Should the CLI capture commands be named `before`/`after` or
   `record-before`/`record-after`?
3. What is the approved retention and cleanup policy for source blobs beyond
   the rule that referenced blobs must be retained?
