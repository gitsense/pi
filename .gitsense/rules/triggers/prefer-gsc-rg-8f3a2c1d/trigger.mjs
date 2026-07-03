import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let ctx;
try {
  ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const command = ctx.toolCall?.command ?? ctx.payload?.toolCall?.command ?? "";
const action = ctx.toolCall?.action ?? ctx.payload?.toolCall?.action;

if (action !== "bash" || !command.trim().startsWith("rg")) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

function commandExists(name) {
  try {
    execFileSync(name, ["--version"], { encoding: "utf8", timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function loadBrains() {
  try {
    const out = execFileSync("gsc", ["brains", "--json"], {
      encoding: "utf8",
      timeout: 3000,
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed.databases) ? parsed.databases : [];
  } catch {
    return [];
  }
}

function pickSearchBrain(brains) {
  const hasField = (brain, fieldName) =>
    Array.isArray(brain.fields) && brain.fields.some((field) => field.name === fieldName);

  return (
    brains.find((brain) => brain.name === "code-intent" && hasField(brain, "purpose")) ??
    brains.find((brain) => hasField(brain, "purpose")) ??
    brains.find((brain) => Array.isArray(brain.fields) && brain.fields.length > 0) ??
    null
  );
}

function splitFirstPipelineSegment(rawCommand) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < rawCommand.length; index += 1) {
    const char = rawCommand[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "|" || char === ";" || char === "\n") {
      return rawCommand.slice(0, index).trim();
    }

    if ((char === "&" && rawCommand[index + 1] === "&") || (char === "|" && rawCommand[index + 1] === "|")) {
      return rawCommand.slice(0, index).trim();
    }
  }

  return rawCommand.trim();
}

function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of segment) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote || escaped) return null;
  if (current) tokens.push(current);
  return tokens;
}

const optionsWithValue = new Set([
  "-A",
  "-B",
  "-C",
  "-e",
  "-f",
  "-g",
  "-m",
  "-t",
  "-T",
  "--after-context",
  "--before-context",
  "--context",
  "--context-separator",
  "--engine",
  "--field-context-separator",
  "--field-match-separator",
  "--file",
  "--glob",
  "--iglob",
  "--json-path",
  "--max-columns",
  "--max-count",
  "--max-depth",
  "--path-separator",
  "--pre",
  "--pre-glob",
  "--regex-size-limit",
  "--replace",
  "--sort",
  "--sortr",
  "--threads",
  "--type",
  "--type-add",
  "--type-clear",
]);

function isOptionWithInlineValue(token) {
  return [...optionsWithValue].some((option) => token.startsWith(`${option}=`));
}

function extractPositionals(tokens) {
  const positionals = [];
  let hasFilesMode = false;
  let patternProvidedByFlag = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--") {
      positionals.push(...tokens.slice(index + 1));
      break;
    }

    if (token === "--files") {
      hasFilesMode = true;
      continue;
    }

    if (token === "-e" || token === "--regexp") {
      patternProvidedByFlag = true;
      index += 1;
      continue;
    }

    if (optionsWithValue.has(token)) {
      index += 1;
      continue;
    }

    if (isOptionWithInlineValue(token)) {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    positionals.push(token);
  }

  return { hasFilesMode, patternProvidedByFlag, positionals };
}

function isTempOrExternalPath(token) {
  return token.startsWith("/tmp/") || token.startsWith("/private/tmp/");
}

function isClearlyIndividualFile(token, cwd) {
  if (!token || token.includes("*") || token.includes("?") || token.includes("[") || token.includes("]")) {
    return false;
  }

  if (isTempOrExternalPath(token)) return true;

  const absolutePath = path.isAbsolute(token) ? token : path.resolve(cwd, token);
  try {
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function looksLikeBroadDiscovery(rawCommand, cwd) {
  if (rawCommand.includes("$(") || rawCommand.includes("`")) return false;

  const segment = splitFirstPipelineSegment(rawCommand);
  const tokens = tokenize(segment);
  if (!tokens || tokens[0] !== "rg") return false;

  const { hasFilesMode, patternProvidedByFlag, positionals } = extractPositionals(tokens);
  if (hasFilesMode) return false;

  const pathOperands = patternProvidedByFlag ? positionals : positionals.slice(1);
  if (pathOperands.length === 0) return true;

  return !pathOperands.every((operand) => isClearlyIndividualFile(operand, cwd));
}

if (!commandExists("rg") || !commandExists("gsc")) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const brains = loadBrains();
const searchBrain = pickSearchBrain(brains);
if (!searchBrain) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const cwd = ctx.session?.cwd ?? ctx.repo?.root ?? process.cwd();
if (!looksLikeBroadDiscovery(command, cwd)) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const hasPurpose = Array.isArray(searchBrain.fields) && searchBrain.fields.some((field) => field.name === "purpose");
const fieldHint = hasPurpose ? " --fields purpose" : "";

console.log(
  JSON.stringify({
    matched: true,
    block: true,
    message:
      "This command looks like broad repository discovery with plain `rg`, and this repo has active GitSense Brains. " +
      `Prefer \`gsc rg <pattern> --db ${searchBrain.name}${fieldHint}\` so search results include Brain metadata. ` +
      `Use \`gsc rg <pattern> --db ${searchBrain.name} --summary\` when you only need aggregate match/file counts. ` +
      "Plain `rg` is still acceptable for targeted line lookup in known individual files.",
    notice: "Blocked broad plain rg discovery because gsc rg can use active Brains.",
  })
);
