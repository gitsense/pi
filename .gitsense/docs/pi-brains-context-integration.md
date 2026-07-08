# pi-brains Context Integration Spec

This document specifies how pi-brains populates agent-specific context fields for executable triggers.

## Overview

pi-brains is the integration adapter between Pi and gsc rules. When a rule requests agent-specific context via `contextFields`, pi-brains:

1. Reads `contextFields` from the matched rule
2. Calls the appropriate ExtensionAPI methods
3. Populates the V1 context with requested fields
4. Passes the context to the trigger

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Pi Agent                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   ExtensionAPI                        │  │
│  │  getCommands() getActiveTools() getModel() ...        │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                    pi-brains                          │  │
│  │  1. Match rule via gsc rules get                      │  │
│  │  2. Read contextFields from rule                      │  │
│  │  3. Call ExtensionAPI methods                         │  │
│  │  4. Build V1 context with pi.* fields                 │  │
│  │  5. Execute trigger with context JSON                 │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │               gsc rules execute                       │  │
│  │  stdin: V1 context JSON                               │  │
│  │  stdout: { matched, block, message, notice }          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### Step 1: Read contextFields from Rule

When pi-brains matches a rule via `gsc rules get --format json`, the response includes:

```json
{
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
      }
    }
  ]
}
```

pi-brains reads `rule.contextFields` to determine what agent context to populate.

### Step 2: Map contextFields to ExtensionAPI Methods

| contextField | ExtensionAPI Method | Return Type |
|--------------|---------------------|-------------|
| `pi.commands` | `getCommands()` | `SlashCommandInfo[]` |
| `pi.activeTools` | `getActiveTools()` | `string[]` |
| `pi.allTools` | `getAllTools()` | `ToolInfo[]` |
| `pi.thinkingLevel` | `getThinkingLevel()` | `string` |
| `pi.model` | `getModel()` | `Model` |
| `pi.sessionName` | `getSessionName()` | `string \| undefined` |
| `pi.isProjectTrusted` | `isProjectTrusted()` | `boolean` |
| `pi.contextUsage` | `getContextUsage()` | `ContextUsage \| undefined` |

### Step 3: Build Context Object

pi-brains builds the V1 context with requested fields:

```typescript
interface V1Context {
  version: "1";
  event: { name: string };
  agent: AgentInfo;
  capabilities: { canBlock: boolean };
  session: SessionInfo;
  conversation: ConversationInfo;
  model: ModelInfo | null;
  toolCall: ToolCallInfo;
  repo: RepoInfo | null;
  rule: RuleInfo;
  pi?: PiContext;  // Agent-specific context
}

interface PiContext {
  commands?: SlashCommandInfo[];
  activeTools?: string[];
  allTools?: ToolInfo[];
  thinkingLevel?: string;
  model?: Model;
  sessionName?: string | null;
  isProjectTrusted?: boolean;
  contextUsage?: ContextUsage | null;
}
```

### Step 4: Populate Fields

```typescript
function buildPiContext(
  contextFields: string[],
  extensionApi: ExtensionAPI
): PiContext | undefined {
  if (!contextFields.some(f => f.startsWith("pi."))) {
    return undefined;
  }

  const context: PiContext = {};

  for (const field of contextFields) {
    switch (field) {
      case "pi.commands":
        context.commands = extensionApi.getCommands();
        break;
      case "pi.activeTools":
        context.activeTools = extensionApi.getActiveTools();
        break;
      case "pi.allTools":
        context.allTools = extensionApi.getAllTools();
        break;
      case "pi.thinkingLevel":
        context.thinkingLevel = extensionApi.getThinkingLevel();
        break;
      case "pi.model":
        context.model = extensionApi.getModel();
        break;
      case "pi.sessionName":
        context.sessionName = extensionApi.getSessionName();
        break;
      case "pi.isProjectTrusted":
        context.isProjectTrusted = extensionApi.isProjectTrusted();
        break;
      case "pi.contextUsage":
        context.contextUsage = extensionApi.getContextUsage();
        break;
      default:
        // Unknown field, skip
        break;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}
```

### Step 5: Execute Trigger

```typescript
async function executeTrigger(
  rule: Rule,
  toolCall: ToolCallInfo,
  extensionApi: ExtensionAPI
): Promise<TriggerResult> {
  // Build base context
  const context: V1Context = {
    version: "1",
    event: { name: rule.event },
    agent: {
      id: "pi",
      displayName: "Pi",
      adapter: "pi-brains",
      contextProvider: "pi-brains",
      session: {
        historyAvailable: true,
        toolCallsCommand: buildToolCallsCommand(session)
      }
    },
    capabilities: { canBlock: true },
    session: buildSessionInfo(),
    conversation: buildConversationInfo(),
    model: buildModelInfo(),
    toolCall,
    repo: buildRepoInfo(),
    rule: buildRuleInfo(rule)
  };

  // Populate agent-specific context if requested
  if (rule.contextFields) {
    context.pi = buildPiContext(rule.contextFields, extensionApi);
  }

  // Execute trigger
  const result = await runTriggerScript(
    rule.trigger.runtime,
    rule.trigger.entry,
    JSON.stringify(context),
    rule.trigger.timeoutMs ?? 5000
  );

  return JSON.parse(result);
}
```

## Caching Strategy

### Problem

Multiple triggers may request the same fields in a single turn. Calling ExtensionAPI repeatedly is wasteful.

### Solution

Cache context field values per turn:

```typescript
class ContextCache {
  private cache = new Map<string, unknown>();
  private turnId: string;

  constructor(turnId: string) {
    this.turnId = turnId;
  }

  get(field: string): unknown | undefined {
    return this.cache.get(field);
  }

  set(field: string, value: unknown): void {
    this.cache.set(field, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Usage in pi-brains
function buildPiContextCached(
  contextFields: string[],
  extensionApi: ExtensionAPI,
  cache: ContextCache
): PiContext | undefined {
  const context: PiContext = {};

  for (const field of contextFields) {
    // Check cache first
    const cached = cache.get(field);
    if (cached !== undefined) {
      context[field.replace("pi.", "")] = cached;
      continue;
    }

    // Fetch and cache
    let value: unknown;
    switch (field) {
      case "pi.commands":
        value = extensionApi.getCommands();
        break;
      case "pi.activeTools":
        value = extensionApi.getActiveTools();
        break;
      // ... other fields
    }

    if (value !== undefined) {
      cache.set(field, value);
      context[field.replace("pi.", "")] = value;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}
```

## Error Handling

### Missing Fields

If a requested field is not available:

```typescript
function buildPiContext(
  contextFields: string[],
  extensionApi: ExtensionAPI
): PiContext {
  const context: PiContext = {};

  for (const field of contextFields) {
    try {
      switch (field) {
        case "pi.commands":
          context.commands = extensionApi.getCommands();
          break;
        case "pi.activeTools":
          context.activeTools = extensionApi.getActiveTools();
          break;
        // ... other fields
      }
    } catch (error) {
      // Log error but continue
      console.error(`Failed to populate ${field}:`, error);
      // Field will be undefined in context
    }
  }

  return context;
}
```

### Unknown Fields

If `contextFields` contains unknown fields:

```typescript
const VALID_PI_FIELDS = new Set([
  "pi.commands",
  "pi.activeTools",
  "pi.allTools",
  "pi.thinkingLevel",
  "pi.model",
  "pi.sessionName",
  "pi.isProjectTrusted",
  "pi.contextUsage"
]);

function validateContextFields(contextFields: string[]): string[] {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const field of contextFields) {
    if (VALID_PI_FIELDS.has(field)) {
      valid.push(field);
    } else {
      invalid.push(field);
    }
  }

  if (invalid.length > 0) {
    console.warn(`Unknown context fields: ${invalid.join(", ")}`);
  }

  return valid;
}
```

### Timeout Handling

If ExtensionAPI calls are slow:

```typescript
async function buildPiContextWithTimeout(
  contextFields: string[],
  extensionApi: ExtensionAPI,
  timeoutMs: number = 100
): Promise<PiContext | undefined> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Context build timeout")), timeoutMs);
  });

  try {
    return await Promise.race([
      buildPiContextAsync(contextFields, extensionApi),
      timeout
    ]);
  } catch (error) {
    console.error("Context build timed out, returning partial context");
    return undefined;
  }
}
```

## Performance Considerations

### Field Cost

| Field | Cost | Notes |
|-------|------|-------|
| `pi.commands` | Low | Typically 10-50 commands |
| `pi.activeTools` | Low | Typically 5-15 tools |
| `pi.allTools` | Medium | Includes parameters, may be 50-100 tools |
| `pi.thinkingLevel` | Minimal | Single string |
| `pi.model` | Minimal | Single object |
| `pi.sessionName` | Minimal | Single string or null |
| `pi.isProjectTrusted` | Minimal | Single boolean |
| `pi.contextUsage` | Low | Single object |

### Best Practices

1. **Request only needed fields** - Don't request `pi.allTools` if you only need `pi.activeTools`
2. **Cache per turn** - Avoid redundant ExtensionAPI calls
3. **Set reasonable timeouts** - Default 100ms for context build
4. **Handle missing fields** - Triggers should work without optional fields

## Integration Points

### gsc rules get

pi-brains queries rules with:

```bash
gsc rules get --file <path> --action <action> --format json
```

The response includes `contextFields` if present in the rule.

### gsc rules execute

pi-brains executes triggers with:

```bash
gsc rules trigger run <rule-id> --context <context-file>
```

Or directly via:

```bash
node <trigger-path> < <context-file>
```

### ExtensionAPI Access

pi-brains accesses ExtensionAPI through the bound methods in `agent-session.ts`:

```typescript
// In agent-session.ts
runner.bindCore({
  getCommands,
  getActiveTools: () => this.getActiveToolNames(),
  getAllTools: () => this.getAllTools(),
  getThinkingLevel: () => this.thinkingLevel,
  getModel: () => this.model,
  getSessionName: () => this.sessionManager.getSessionName(),
  isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
  getContextUsage: () => this.getContextUsage(),
  // ... other methods
});
```

## Testing

### Unit Tests

```typescript
describe("buildPiContext", () => {
  it("should populate requested fields", () => {
    const mockApi = {
      getCommands: () => [{ name: "test", source: "extension" }],
      getActiveTools: () => ["read", "bash"],
      getModel: () => ({ provider: "anthropic", id: "claude-sonnet-4-5" })
    };

    const context = buildPiContext(
      ["pi.commands", "pi.activeTools"],
      mockApi as any
    );

    expect(context.commands).toHaveLength(1);
    expect(context.activeTools).toEqual(["read", "bash"]);
    expect(context.model).toBeUndefined();
  });

  it("should handle missing fields gracefully", () => {
    const mockApi = {
      getCommands: () => { throw new Error("Not available"); }
    };

    const context = buildPiContext(["pi.commands"], mockApi as any);

    expect(context.commands).toBeUndefined();
  });
});
```

### Integration Tests

```typescript
describe("pi-brains context integration", () => {
  it("should pass pi.commands to trigger", async () => {
    // Setup rule with contextFields: ["pi.commands"]
    // Mock ExtensionAPI with test commands
    // Execute trigger
    // Verify trigger receives commands in ctx.pi.commands
  });

  it("should cache fields across multiple triggers", async () => {
    // Setup multiple rules requesting same fields
    // Execute all triggers
    // Verify ExtensionAPI called only once per field
  });
});
```

## Migration Guide

### For Existing Rules

Existing rules without `contextFields` continue to work unchanged. The `pi` field is only present in context when requested.

### For Trigger Code

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

### For Agent Integrations

Other agent integrations (codex, opencode) can follow the same pattern:

1. Define their own context fields (e.g., `codex.sandboxStatus`)
2. Document in Agent Context Reference
3. Implement population in their context provider
4. Test with sample triggers

---

## Changelog

- **2026-07-07**: Initial spec with Pi context fields
