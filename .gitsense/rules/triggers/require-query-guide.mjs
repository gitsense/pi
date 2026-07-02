import { execFileSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const guideByCommand = {
  query: { guide: "query", label: "query" },
  rg: { guide: "visualization", label: "visualization" },
  notes: { guide: "notes", label: "notes" },
  rules: { guide: "rules", label: "rules" },
};

const command = ctx.toolCall?.command ?? "";
const match = command.match(/^gsc\s+(query|rg|notes|rules)(\s|$)/);
const commandGroup = match?.[1];
const requiredGuide = guideByCommand[commandGroup];
const applies = ctx.toolCall?.action === "bash" && Boolean(requiredGuide);

if (!applies) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const canReadHistory =
  ctx.agent?.id === "pi" &&
  ctx.agent?.session?.historyAvailable &&
  ctx.session?.path &&
  ctx.conversation?.leafId;

if (!canReadHistory) {
  // Cannot verify history — allow the call (fail open)
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

let guideLoaded = false;

try {
  const out = execFileSync(
    "gsc",
    [
      "pi", "sessions", "tool-calls",
      "--session", ctx.session.path,
      "--leaf", ctx.conversation.leafId,
      "--format", "json"
    ],
    { encoding: "utf8", timeout: 10000 }
  );

  const history = JSON.parse(out);
  guideLoaded = history.toolCalls?.some(
    (tc) =>
      tc.toolName === "bash" &&
      tc.arguments?.command?.includes(`gsc experts guide ${requiredGuide.guide}`)
  );
} catch {
  // Error reading history — allow the call (fail open)
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

if (!guideLoaded) {
  console.log(
    JSON.stringify({
      matched: true,
      block: true,
      message: `Before using \`gsc ${commandGroup}\`, you must first load the ${requiredGuide.label} guide: \`gsc experts guide ${requiredGuide.guide}\``,
      notice: `Blocked: ${requiredGuide.label} guide not loaded in this session.`,
    })
  );
} else {
  console.log(JSON.stringify({ matched: false, block: false }));
}
