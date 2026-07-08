// block-invalid-commands-7f3a9b2c/trigger.mjs
// Blocks invalid slash commands by validating against pi.commands context field.
//
// This trigger demonstrates the contextFields feature:
// - Rule requests "pi.commands" in contextFields
// - pi-brains populates ctx.pi.commands from ExtensionAPI.getCommands()
// - Trigger validates user input against available commands

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

// Extract command name (handle arguments and skill: prefix)
const parts = text.slice(1).split(" ");
const cmdPart = parts[0];
const cmdName = cmdPart.includes(":") ? cmdPart.split(":")[0] : cmdPart;

// Get valid commands from context
const validCommands = ctx.pi?.commands ?? [];

// Check if command exists
const isValid = validCommands.some(c => {
  const name = c.name;
  // Handle skill: prefix
  if (name.startsWith("skill:")) {
    return name === `skill:${cmdName}` || name === cmdPart;
  }
  return name === cmdName || name === cmdPart;
});

// Build list of valid commands for error message
const commandList = validCommands
  .slice(0, 10)
  .map(c => `/${c.name}`)
  .join(", ");
const moreCount = validCommands.length > 10 ? ` (and ${validCommands.length - 10} more)` : "";

console.log(JSON.stringify({
  matched: !isValid,
  block: !isValid,
  message: !isValid
    ? `Unknown command: /${cmdName}. Valid commands: ${commandList}${moreCount}. Use /commands to see all available commands.`
    : undefined,
  notice: !isValid
    ? `Blocked invalid slash command: /${cmdName}`
    : undefined
}));
