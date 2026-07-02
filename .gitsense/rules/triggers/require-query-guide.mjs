import { execFileSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString("utf8"));

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
      tc.arguments?.command?.includes("gsc experts guide query")
  );
} catch {
  // Error reading history — allow the call (fail open)
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const isQueryCommand = ctx.toolCall?.action === "bash" && ctx.toolCall?.command?.startsWith("gsc query");

if (isQueryCommand && !guideLoaded) {
  console.log(
    JSON.stringify({
      matched: true,
      block: true,
      message:
        "Before using `gsc query`, you must first load the query guide: `gsc experts guide query`",
      notice: "Blocked: query guide not loaded in this session.",
    })
  );
} else {
  console.log(JSON.stringify({ matched: false, block: false }));
}
