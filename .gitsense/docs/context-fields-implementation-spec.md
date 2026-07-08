# contextFields Implementation Spec

This document specifies how to add `contextFields` support to the gsc rules schema, storage, and integration layer.

## Overview

`contextFields` allows rules to declare what agent-specific context they need. When a rule requests fields like `pi.commands`, the agent integration (pi-brains) populates those fields in the V1 context before executing the trigger.

## Changes Required

### 1. Rule JSON Schema

Add `contextFields` as an optional array of strings:

```json
{
  "type": "executable",
  "summary": "Block invalid slash commands",
  "topic": "tool-gates",
  "event": "user_prompt_submit",
  "actions": ["prompt"],
  "contextFields": ["pi.commands"],
  "trigger": {
    "runtime": "node",
    "entry": "block-invalid-commands/trigger.mjs"
  }
}
```

**Field definition:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `contextFields` | `string[]` | No | Agent-specific context fields to populate |

**Field naming convention:** `<agent-id>.<field-name>`

Examples:
- `pi.commands` - Pi's available slash commands
- `pi.activeTools` - Pi's active tool names
- `codex.sandboxStatus` - Codex's sandbox status (future)

### 2. Rule Storage Schema

Add `context_fields` to the rule record in `records.jsonl`:

```json
{
  "id": "rule_019f...",
  "schema_version": "3.1.0",
  "type": "executable",
  "summary": "Block invalid slash commands",
  "topic": "tool-gates",
  "event": "user_prompt_submit",
  "actions": ["prompt"],
  "context_fields": ["pi.commands"],
  "trigger": {
    "runtime": "node",
    "entry": "block-invalid-commands/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "Only use valid slash commands."
  },
  "frequency": {
    "mode": "always"
  },
  "priority": 100,
  "enabled": true
}
```

**Schema version:** Bump to `3.1.0` for backward compatibility.

**Field mapping:**

| JSON Field | Storage Field | Notes |
|------------|---------------|-------|
| `contextFields` | `context_fields` | Snake case in storage |

### 3. Validation Logic

#### Rule Creation Validation

When creating a rule with `--creator agent`:

```typescript
function validateContextFields(contextFields: string[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of contextFields) {
    // Check format: <agent-id>.<field-name>
    const parts = field.split(".");
    if (parts.length !== 2) {
      errors.push(`Invalid context field format: "${field}". Expected "<agent-id>.<field-name>".`);
      continue;
    }

    const [agentId, fieldName] = parts;

    // Check agent ID is known
    if (!KNOWN_AGENTS.includes(agentId)) {
      warnings.push(`Unknown agent ID: "${agentId}". Field will be ignored if agent is not present.`);
    }

    // Check field name is known for agent
    const knownFields = AGENT_FIELDS[agentId];
    if (knownFields && !knownFields.includes(fieldName)) {
      warnings.push(`Unknown field "${fieldName}" for agent "${agentId}". Known fields: ${knownFields.join(", ")}.`);
    }
  }

  return { errors, warnings };
}
```

**Known agents and fields:**

```typescript
const KNOWN_AGENTS = ["pi", "codex"];

const AGENT_FIELDS: Record<string, string[]> = {
  pi: [
    "commands",
    "activeTools",
    "allTools",
    "thinkingLevel",
    "model",
    "sessionName",
    "isProjectTrusted",
    "contextUsage"
  ],
  codex: [
    "sandboxStatus",
    "approvalPolicy",
    "plugins"
  ]
};
```

#### Creator Checklist Validation

Add to `creatorChecklist`:

```json
{
  "creatorChecklist": {
    "creator": "agent",
    "intent": "Block invalid slash commands.",
    "scope": "personal",
    "ruleKind": "executable-trigger",
    "contextFields": {
      "requested": ["pi.commands"],
      "verified": true,
      "verifiedFrom": "gsc experts guide agent-context"
    },
    "topic": {
      "slug": "tool-gates",
      "source": "existing",
      "verifiedFrom": "gsc topics list"
    }
  }
}
```

**Validation rules:**

1. If `contextFields` is present in rule JSON, `creatorChecklist.contextFields` must be present
2. `creatorChecklist.contextFields.requested` must match rule's `contextFields`
3. `creatorChecklist.contextFields.verified` must be `true`
4. `creatorChecklist.contextFields.verifiedFrom` must reference documentation

### 4. gsc rules get Output

Include `contextFields` in JSON output:

```json
{
  "query": {
    "file": "input.ts",
    "action": "prompt"
  },
  "rules": [
    {
      "rule": {
        "id": "rule_019f...",
        "summary": "Block invalid slash commands",
        "type": "tool-trigger",
        "contextFields": ["pi.commands"],
        "trigger": {
          "runtime": "node",
          "entry": "block-invalid-commands/trigger.mjs"
        }
      },
      "match_reason": "action: prompt",
      "match": {
        "kind": "action",
        "value": "prompt"
      }
    }
  ]
}
```

### 5. gsc rules show Output

Include `contextFields` in human-readable output:

```
Source: personal
rule_019f... [high] (executable)
Summary: Block invalid slash commands

Enabled: true
Trigger:
  Runtime: node
  Entry: block-invalid-commands/trigger.mjs
  Timeout: 5000ms
Context Fields:
  - pi.commands
Instruction:
  Mode: inline
  Text: Only use valid slash commands.
Frequency: always
```

### 6. gsc rules export/import

Include `contextFields` in exported bundles:

```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "rule_019f...",
      "type": "executable",
      "summary": "Block invalid slash commands",
      "contextFields": ["pi.commands"],
      "trigger": { ... }
    }
  ],
  "triggers": {
    "block-invalid-commands/trigger.mjs": "base64-encoded-content"
  }
}
```

### 7. pi-brains Integration

#### Reading contextFields

pi-brains reads `contextFields` from matched rules:

```typescript
async function processRuleMatch(
  rule: RuleMatch,
  toolCall: ToolCallInfo,
  extensionApi: ExtensionAPI
): Promise<TriggerResult> {
  // Build base context
  const context = buildBaseContext(rule, toolCall);

  // Populate agent-specific context if requested
  if (rule.contextFields && rule.contextFields.length > 0) {
    context.pi = buildPiContext(rule.contextFields, extensionApi);
  }

  // Execute trigger
  return executeTrigger(rule, context);
}
```

#### Building Pi Context

```typescript
function buildPiContext(
  contextFields: string[],
  extensionApi: ExtensionAPI
): PiContext {
  const context: PiContext = {};

  for (const field of contextFields) {
    if (!field.startsWith("pi.")) continue;

    const fieldName = field.slice(3); // Remove "pi."
    try {
      switch (fieldName) {
        case "commands":
          context.commands = extensionApi.getCommands();
          break;
        case "activeTools":
          context.activeTools = extensionApi.getActiveTools();
          break;
        case "allTools":
          context.allTools = extensionApi.getAllTools();
          break;
        case "thinkingLevel":
          context.thinkingLevel = extensionApi.getThinkingLevel();
          break;
        case "model":
          context.model = extensionApi.getModel();
          break;
        case "sessionName":
          context.sessionName = extensionApi.getSessionName();
          break;
        case "isProjectTrusted":
          context.isProjectTrusted = extensionApi.isProjectTrusted();
          break;
        case "contextUsage":
          context.contextUsage = extensionApi.getContextUsage();
          break;
      }
    } catch (error) {
      // Log but don't fail
      console.error(`Failed to populate ${field}:`, error);
    }
  }

  return context;
}
```

#### Caching

Cache context fields per turn to avoid redundant calls:

```typescript
class ContextCache {
  private cache = new Map<string, unknown>();
  private turnId: string;

  constructor(turnId: string) {
    this.turnId = turnId;
  }

  getOrFetch<T>(field: string, fetcher: () => T): T {
    if (this.cache.has(field)) {
      return this.cache.get(field) as T;
    }
    const value = fetcher();
    this.cache.set(field, value);
    return value;
  }

  clear(): void {
    this.cache.clear();
  }
}
```

### 8. gsc rules trigger validate

Add validation for `contextFields`:

```bash
gsc rules trigger validate rule_019f...
```

**Validation checks:**

1. `contextFields` is an array of strings
2. Each field matches `<agent-id>.<field-name>` format
3. Agent IDs are from known list (with warning for unknown)
4. Field names are from known list for agent (with warning for unknown)

### 9. gsc rules trigger template

Update template to include `contextFields` example:

```bash
gsc rules trigger template --full
```

**Output includes:**

```json
{
  "type": "executable",
  "summary": "...",
  "topic": "...",
  "event": "pre_tool_use",
  "actions": ["bash"],
  "contextFields": ["pi.commands"],
  "trigger": {
    "runtime": "node",
    "entry": "my-trigger-abc123/trigger.mjs",
    "timeoutMs": 5000
  },
  "instruction": {
    "mode": "inline",
    "text": "..."
  },
  "frequency": {
    "mode": "once-per-session"
  },
  "creatorChecklist": {
    "creator": "agent",
    "intent": "...",
    "scope": "personal",
    "ruleKind": "executable-trigger",
    "contextFields": {
      "requested": ["pi.commands"],
      "verified": true,
      "verifiedFrom": "gsc experts guide agent-context"
    }
  }
}
```

## Implementation Checklist

### Phase 1: Schema & Storage

- [ ] Add `context_fields` to rule record schema (v3.1.0)
- [ ] Update `gsc rules new` to accept `contextFields`
- [ ] Update `gsc rules update` to accept `contextFields`
- [ ] Update `gsc rules show` to display `contextFields`
- [ ] Update `gsc rules get` JSON output to include `contextFields`
- [ ] Update `gsc rules export` to include `contextFields`
- [ ] Update `gsc rules import` to handle `contextFields`

### Phase 2: Validation

- [ ] Add `contextFields` validation to rule creation
- [ ] Add `creatorChecklist.contextFields` validation
- [ ] Update `gsc rules trigger validate` to check `contextFields`
- [ ] Update `gsc rules trigger template` to include `contextFields` example

### Phase 3: pi-brains Integration

- [ ] Read `contextFields` from matched rules
- [ ] Implement `buildPiContext()` function
- [ ] Add context caching per turn
- [ ] Pass `pi.*` fields in V1 context
- [ ] Test with block-invalid-commands trigger

### Phase 4: Documentation

- [ ] Update Agent Context Reference with implementation details
- [ ] Update pi-brains Integration Spec with code examples
- [ ] Add examples to gsc rules documentation
- [ ] Create migration guide for existing rules

## Migration Guide

### Existing Rules

Existing rules without `contextFields` continue to work unchanged. The `pi` field is only present in context when requested.

### Rule Records

Old rule records (v3.0.0) without `context_fields` are valid. New rules can include `context_fields`.

### Trigger Code

Triggers should check for `pi` field presence:

```javascript
// Safe access
const commands = ctx.pi?.commands ?? [];
const activeTools = ctx.pi?.activeTools ?? [];

// Check if field was requested
if (!ctx.pi?.commands) {
  // Field not available, use fallback or skip
}
```

## Testing

### Unit Tests

```typescript
describe("contextFields validation", () => {
  it("should accept valid context fields", () => {
    const result = validateContextFields(["pi.commands", "pi.activeTools"]);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject invalid format", () => {
    const result = validateContextFields(["invalid"]);
    expect(result.errors).toHaveLength(1);
  });

  it("should warn on unknown agent", () => {
    const result = validateContextFields(["unknown.field"]);
    expect(result.warnings).toHaveLength(1);
  });
});
```

### Integration Tests

```typescript
describe("pi-brains context integration", () => {
  it("should populate pi.commands when requested", async () => {
    const rule = {
      contextFields: ["pi.commands"],
      trigger: { ... }
    };

    const context = await buildContext(rule, mockExtensionApi);

    expect(context.pi.commands).toBeDefined();
    expect(context.pi.commands).toHaveLength(3);
  });

  it("should not populate pi fields when not requested", async () => {
    const rule = {
      trigger: { ... }
    };

    const context = await buildContext(rule, mockExtensionApi);

    expect(context.pi).toBeUndefined();
  });
});
```

### End-to-End Tests

```typescript
describe("block-invalid-commands trigger", () => {
  it("should block invalid commands", async () => {
    const result = await runTrigger({
      event: "user_prompt_submit",
      input: { text: "/invalid" },
      pi: { commands: [{ name: "settings" }] }
    });

    expect(result.matched).toBe(true);
    expect(result.block).toBe(true);
  });

  it("should allow valid commands", async () => {
    const result = await runTrigger({
      event: "user_prompt_submit",
      input: { text: "/settings" },
      pi: { commands: [{ name: "settings" }] }
    });

    expect(result.matched).toBe(false);
    expect(result.block).toBe(false);
  });
});
```

---

## Changelog

- **2026-07-07**: Initial spec
