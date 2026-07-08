# Agent Context Reference

This document defines the V1 context schema for executable triggers and the requestable agent-specific context fields available for each supported agent integration.

## Table of Contents

- [Overview](#overview)
- [V1 Context Schema](#v1-context-schema)
- [Requesting Agent Context](#requesting-agent-context)
- [Agent Integrations](#agent-integrations)
  - [Pi](#pi)
  - [Codex (Future)](#codex-future)
- [Common Patterns](#common-patterns)
- [Security Considerations](#security-considerations)

---

## Overview

Executable triggers receive context as JSON on stdin. The context includes:

1. **Standard fields** - Always available (event, toolCall, session, conversation, model, repo, rule)
2. **Agent-specific fields** - Available when requested via `contextFields` in the rule JSON

This design keeps `gsc rules execute` isolated (string in, string out) while enabling rich context when needed.

---

## V1 Context Schema

### Standard Fields (Always Available)

```json
{
  "version": "1",
  "event": {
    "name": "pre_tool_use" | "user_prompt_submit" | "post_tool_use"
  },
  "agent": {
    "id": "pi",
    "displayName": "Pi",
    "adapter": "pi-brains",
    "contextProvider": "pi-brains",
    "session": {
      "historyAvailable": true,
      "toolCallsCommand": "gsc pi sessions tool-calls --session <session.path> --leaf <conversation.leafId> --format json"
    }
  },
  "capabilities": {
    "canBlock": true
  },
  "session": {
    "id": "019eeaab-...",
    "path": "/abs/session.jsonl",
    "cwd": "/tmp"
  },
  "conversation": {
    "leafId": "entry-9",
    "messageIds": ["entry-1", "entry-2", "entry-9"]
  },
  "model": {
    "provider": "anthropic",
    "id": "claude-sonnet-4-5",
    "thinkingLevel": "medium"
  },
  "toolCall": {
    "id": "call-001",
    "toolName": "read",
    "action": "read",
    "file": "/abs/repo/data/file.txt",
    "command": null,
    "input": { "path": "data/file.txt" }
  },
  "repo": {
    "root": "/abs/repo",
    "normalizedFile": "data/file.txt"
  },
  "rule": {
    "id": "rule_...",
    "summary": "...",
    "type": "tool-trigger",
    "ruleHash": "sha256:...",
    "triggerHash": "sha256:..."
  }
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Schema version, currently `"1"` |
| `event.name` | `string` | Lifecycle event name |
| `agent.id` | `string` | Agent identifier (e.g., `"pi"`, `"codex"`) |
| `agent.displayName` | `string` | Human-readable agent name |
| `agent.adapter` | `string` | Integration adapter (e.g., `"pi-brains"`) |
| `agent.contextProvider` | `string` | Context provider implementation |
| `agent.session.historyAvailable` | `boolean` | Whether session history can be queried |
| `agent.session.toolCallsCommand` | `string` | Command to read prior tool calls |
| `capabilities.canBlock` | `boolean` | Whether trigger can block actions |
| `session.id` | `string` | Session identifier |
| `session.path` | `string` | Absolute path to session file |
| `session.cwd` | `string` | Current working directory |
| `conversation.leafId` | `string` | Current leaf entry ID |
| `conversation.messageIds` | `string[]` | Message IDs in current context |
| `model.provider` | `string?` | Model provider (null if unavailable) |
| `model.id` | `string?` | Model ID (null if unavailable) |
| `model.thinkingLevel` | `string?` | Thinking level (null if unavailable) |
| `toolCall.id` | `string` | Tool call identifier |
| `toolCall.toolName` | `string` | Tool name |
| `toolCall.action` | `string` | Action type (read, edit, write, bash, prompt, etc.) |
| `toolCall.file` | `string?` | File path (null for non-file tools) |
| `toolCall.command` | `string?` | Bash command (null for non-bash tools) |
| `toolCall.input` | `object` | Tool call parameters |
| `repo.root` | `string?` | Repository root (null if outside repo) |
| `repo.normalizedFile` | `string?` | Repo-relative file path (null for non-file tools) |
| `rule.id` | `string` | Rule identifier |
| `rule.summary` | `string` | Rule summary |
| `rule.type` | `string` | Rule type (`"tool-trigger"`) |
| `rule.ruleHash` | `string` | SHA-256 hash of rule metadata |
| `rule.triggerHash` | `string` | SHA-256 hash of trigger file |

---

## Requesting Agent Context

### Rule JSON

Add `contextFields` to your rule JSON to request agent-specific context:

```json
{
  "type": "executable",
  "summary": "Block invalid slash commands",
  "topic": "command-validation",
  "event": "user_prompt_submit",
  "actions": ["prompt"],
  "contextFields": ["pi.commands"],
  "trigger": {
    "runtime": "node",
    "entry": "block-invalid-commands/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "Only use valid slash commands."
  }
}
```

### Field Naming Convention

Agent-specific fields use the format `<agent-id>.<field-name>`:

- `pi.commands` - Pi's available slash commands
- `pi.activeTools` - Pi's active tool names
- `codex.sandboxStatus` - Codex's sandbox status (future)

### Multiple Fields

Request multiple fields as an array:

```json
{
  "contextFields": ["pi.commands", "pi.activeTools", "pi.model"]
}
```

### How It Works

1. **User declares** `contextFields` in rule JSON
2. **Agent integration** reads `contextFields` when building V1 context
3. **Integration populates** requested fields from agent API
4. **Trigger receives** fields in context JSON under `<agent-id>` key

---

## Agent Integrations

### Pi

**Integration:** `pi-brains`
**Agent ID:** `pi`
**API Source:** `ExtensionAPI` from `@earendil-works/pi-coding-agent`

#### Available Context Fields

| Field | Type | Description | Request |
|-------|------|-------------|---------|
| `pi.commands` | `SlashCommandInfo[]` | Available slash commands | `"pi.commands"` |
| `pi.activeTools` | `string[]` | Active tool names | `"pi.activeTools"` |
| `pi.allTools` | `ToolInfo[]` | All tools with metadata | `"pi.allTools"` |
| `pi.thinkingLevel` | `string` | Current thinking level | `"pi.thinkingLevel"` |
| `pi.model` | `Model` | Current model | `"pi.model"` |
| `pi.sessionName` | `string?` | Session display name | `"pi.sessionName"` |
| `pi.isProjectTrusted` | `boolean` | Project trust status | `"pi.isProjectTrusted"` |
| `pi.contextUsage` | `ContextUsage?` | Token usage | `"pi.contextUsage"` |

#### Type Definitions

##### SlashCommandInfo

```typescript
interface SlashCommandInfo {
  name: string;           // Command name (without leading /)
  description?: string;   // Human-readable description
  source: "extension" | "prompt" | "skill";  // Command source
  sourceInfo: {
    path: string;         // Source file path
    source: string;       // Source type
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}
```

##### ToolInfo

```typescript
interface ToolInfo {
  name: string;           // Tool name
  description: string;    // Tool description
  parameters: object;     // JSON Schema for parameters
  promptGuidelines?: string[];  // Guidelines for LLM
  sourceInfo: {
    path: string;
    source: "builtin" | "sdk" | "extension";
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
  };
}
```

##### Model

```typescript
interface Model {
  provider: string;       // Provider ID (e.g., "anthropic")
  id: string;             // Model ID (e.g., "claude-sonnet-4-5")
  name?: string;          // Display name
  reasoning: boolean;     // Whether model supports reasoning
  contextWindow: number;  // Context window size
  maxTokens: number;      // Max output tokens
}
```

##### ContextUsage

```typescript
interface ContextUsage {
  tokens: number;         // Current token count
  maxTokens: number;      // Maximum tokens
  percentage: number;     // Usage percentage
}
```

#### Example: Block Invalid Slash Commands

**Rule JSON:**

```json
{
  "type": "executable",
  "summary": "Block invalid slash commands",
  "topic": "command-validation",
  "event": "user_prompt_submit",
  "actions": ["prompt"],
  "contextFields": ["pi.commands"],
  "trigger": {
    "runtime": "node",
    "entry": "block-invalid-commands/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "Only use valid slash commands. Use /commands to see available commands."
  },
  "frequency": {
    "mode": "always"
  },
  "enabled": true
}
```

**Trigger Code:**

```javascript
// block-invalid-commands/trigger.mjs
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));

// Only process user prompt submissions
if (ctx.event?.name !== "user_prompt_submit") {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const text = ctx.toolCall?.input?.text;
if (!text?.startsWith("/")) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

// Extract command name (handle arguments)
const cmdName = text.slice(1).split(" ")[0].split(":")[0];

// Get valid commands from context
const validCommands = ctx.pi?.commands ?? [];
const isValid = validCommands.some(c => c.name === cmdName || c.name.startsWith(`${cmdName}:`));

console.log(JSON.stringify({
  matched: !isValid,
  block: !isValid,
  message: !isValid 
    ? `Unknown command: /${cmdName}. Use /commands to see available commands.`
    : undefined,
  notice: !isValid
    ? `Blocked invalid slash command: /${cmdName}`
    : undefined
}));
```

#### Example: Block Calls to Inactive Tools

**Rule JSON:**

```json
{
  "type": "executable",
  "summary": "Block calls to inactive tools",
  "topic": "tool-gates",
  "event": "pre_tool_use",
  "actions": ["tool", "mcp_tool"],
  "contextFields": ["pi.activeTools"],
  "trigger": {
    "runtime": "node",
    "entry": "block-inactive-tools/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "Only call active tools."
  }
}
```

**Trigger Code:**

```javascript
// block-inactive-tools/trigger.mjs
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const toolName = ctx.toolCall?.toolName;
if (!toolName) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const activeTools = ctx.pi?.activeTools ?? [];
const isActive = activeTools.includes(toolName);

console.log(JSON.stringify({
  matched: !isActive,
  block: !isActive,
  message: !isActive 
    ? `Tool "${toolName}" is not active. Active tools: ${activeTools.join(", ")}`
    : undefined
}));
```

#### Example: Model-Specific Behavior

**Rule JSON:**

```json
{
  "type": "executable",
  "summary": "Require higher thinking level for complex tasks",
  "topic": "model-optimization",
  "event": "pre_tool_use",
  "actions": ["bash"],
  "command_filter": "^(npm|yarn|pnpm) (test|build|lint)",
  "contextFields": ["pi.model", "pi.thinkingLevel"],
  "trigger": {
    "runtime": "node",
    "entry": "require-thinking-for-tests/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "Use higher thinking level when running tests or builds."
  }
}
```

**Trigger Code:**

```javascript
// require-thinking-for-tests/trigger.mjs
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const model = ctx.pi?.model;
const thinkingLevel = ctx.pi?.thinkingLevel;

// Only check for models that support reasoning
if (!model?.reasoning) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const highThinkingLevels = ["high", "xhigh"];
const isHighThinking = highThinkingLevels.includes(thinkingLevel);

console.log(JSON.stringify({
  matched: !isHighThinking,
  block: false,  // Warn but don't block
  notice: !isHighThinking
    ? `Consider using higher thinking level for complex tasks. Current: ${thinkingLevel}`
    : undefined
}));
```

---

### Codex (Future)

**Integration:** `codex-brains` (planned)
**Agent ID:** `codex`
**API Source:** Codex API (TBD)

#### Planned Context Fields

| Field | Type | Description | Request |
|-------|------|-------------|---------|
| `codex.sandboxStatus` | `string` | Sandbox status | `"codex.sandboxStatus"` |
| `codex.approvalPolicy` | `string` | Approval policy | `"codex.approvalPolicy"` |
| `codex.plugins` | `string[]` | Active plugins | `"codex.plugins"` |

*Documentation will be updated when Codex integration is implemented.*

---

## Common Patterns

### Pattern 1: Command Validation

Block invalid commands before they reach the agent:

```json
{
  "contextFields": ["pi.commands"],
  "event": "user_prompt_submit",
  "actions": ["prompt"]
}
```

### Pattern 2: Tool Gating

Block calls to inactive or unavailable tools:

```json
{
  "contextFields": ["pi.activeTools"],
  "event": "pre_tool_use",
  "actions": ["tool", "mcp_tool"]
}
```

### Pattern 3: Context-Aware Rules

Adjust behavior based on model or thinking level:

```json
{
  "contextFields": ["pi.model", "pi.thinkingLevel"],
  "event": "pre_tool_use",
  "actions": ["bash"]
}
```

### Pattern 4: Session-Scoped Rules

Apply rules based on session state:

```json
{
  "contextFields": ["pi.sessionName", "pi.isProjectTrusted"],
  "event": "pre_tool_use",
  "actions": ["edit", "write"]
}
```

### Pattern 5: Token Budget Awareness

Enforce token limits:

```json
{
  "contextFields": ["pi.contextUsage"],
  "event": "pre_tool_use",
  "actions": ["bash", "read"]
}
```

---

## Security Considerations

### Read-Only Context

All agent-specific context fields are **read-only state**. They cannot:

- Modify agent behavior
- Change model or thinking level
- Enable/disable tools
- Execute commands

### Isolation

`gsc rules execute` runs triggers in isolation:

- No direct access to agent internals
- Context passed as JSON string (stdin)
- Response expected as JSON string (stdout)
- No persistent state between invocations

### Field Selection

Only request fields you need:

```json
// Good: specific fields
{
  "contextFields": ["pi.commands"]
}

// Avoid: requesting everything
{
  "contextFields": ["pi.commands", "pi.activeTools", "pi.allTools", "pi.model", ...]
}
```

### Agent Trust

Agent-specific fields are populated by the agent integration. The trigger code should:

1. Validate field presence: `ctx.pi?.commands ?? []`
2. Handle missing fields gracefully
3. Not assume fields exist unless requested

---

## Adding New Context Fields

### For Agent Integrations

To add a new context field for your agent:

1. **Define the field** in your agent's API
2. **Document the field** in this reference under your agent section
3. **Implement population** in your context provider (e.g., pi-brains)
4. **Test the field** with a sample trigger

### For Users

To request a new context field:

1. **Check documentation** for available fields
2. **Add to rule JSON** under `contextFields`
3. **Access in trigger** via `ctx.<agent-id>.<field-name>`

### Proposing New Fields

If you need a field that doesn't exist:

1. Open an issue in the agent's repository
2. Describe the use case
3. Propose the field name and type
4. Wait for implementation before using in rules

---

## Quick Reference

### Context Field Requests

| Use Case | Fields to Request |
|----------|-------------------|
| Block invalid commands | `pi.commands` |
| Block inactive tools | `pi.activeTools` |
| Model-specific rules | `pi.model` |
| Thinking level rules | `pi.thinkingLevel` |
| Session-scoped rules | `pi.sessionName` |
| Trust-aware rules | `pi.isProjectTrusted` |
| Token budget rules | `pi.contextUsage` |
| Tool metadata rules | `pi.allTools` |

### Event Types

| Event | When | Use Case |
|-------|------|----------|
| `pre_tool_use` | Before tool execution | Block/modify tool calls |
| `user_prompt_submit` | Before prompt processing | Block/transform prompts |
| `post_tool_use` | After tool execution | Validate results |

### Action Types

| Action | Description |
|--------|-------------|
| `read` | File read |
| `edit` | File edit |
| `write` | File write |
| `bash` | Shell command |
| `prompt` | User prompt |
| `tool` | Generic tool |
| `mcp_tool` | MCP tool |

---

## Changelog

- **2026-07-07**: Initial draft with Pi context fields
