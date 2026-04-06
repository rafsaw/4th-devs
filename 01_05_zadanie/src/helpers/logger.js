/**
 * Logger with verbose/explain mode.
 *
 * VERBOSE=true  — shows full tool args, full tool output
 * VERBOSE=false — truncated output (default)
 */

const VERBOSE = (process.env.VERBOSE ?? "false").toLowerCase() === "true";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m"
};

const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const trunc = (str, max) => {
  if (VERBOSE) return str;
  return str.length > max ? str.substring(0, max) + "..." : str;
};

const log = {
  info: (msg) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}✓${colors.reset} ${msg}`),
  error: (title, msg) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}✗ ${title}${colors.reset} ${msg || ""}`),
  warn: (msg) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${msg}`),
  start: (msg) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}→${colors.reset} ${msg}`),

  box: (text) => {
    const lines = text.split("\n");
    const width = Math.max(...lines.map(l => l.length)) + 4;
    console.log(`\n${colors.cyan}${"─".repeat(width)}${colors.reset}`);
    for (const line of lines) {
      console.log(`${colors.cyan}│${colors.reset} ${colors.bright}${line.padEnd(width - 3)}${colors.reset}${colors.cyan}│${colors.reset}`);
    }
    console.log(`${colors.cyan}${"─".repeat(width)}${colors.reset}\n`);
  },

  query: (q) => console.log(`\n${colors.bgBlue}${colors.white} QUERY ${colors.reset} ${trunc(q, 300)}\n`),
  response: (r) => console.log(`\n${colors.green}Response:${colors.reset} ${trunc(r, 300)}\n`),

  api: (step, msgCount) => console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}◆${colors.reset} ${step} (${msgCount} messages)`),
  apiDone: (usage) => {
    if (usage) {
      console.log(`${colors.dim}         tokens: ${usage.input_tokens} in / ${usage.output_tokens} out${colors.reset}`);
    }
  },

  tool: (name, args) => {
    const argStr = JSON.stringify(args);
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚡${colors.reset} ${name} ${colors.dim}${trunc(argStr, 120)}${colors.reset}`);
    if (VERBOSE) {
      console.log(`${colors.dim}         ARGS: ${argStr}${colors.reset}`);
    }
  },

  toolResult: (name, success, output) => {
    const icon = success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    console.log(`${colors.dim}         ${icon} ${trunc(output, 200)}${colors.reset}`);
    if (VERBOSE && output.length > 200) {
      console.log(`${colors.dim}         FULL OUTPUT: ${output}${colors.reset}`);
    }
  },

  /** After hub verify POST (native `railway_api_call`); matches 01_04_zadanie logger API */
  verify: (timestampOrAttempt, success) => {
    const icon = success
      ? `${colors.bgGreen}${colors.white} PASS ${colors.reset}`
      : `${colors.bgRed}${colors.white} FAIL ${colors.reset}`;
    const isIso =
      typeof timestampOrAttempt === "string"
      && /^\d{4}-\d{2}-\d{2}T/.test(timestampOrAttempt);
    const suffix = isIso
      ? `at ${timestampOrAttempt}`
      : `attempt #${timestampOrAttempt}`;
    console.log(`\n${icon} Verify ${suffix}\n`);
  },

  explain: (title, detail) => {
    if (!VERBOSE) return;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}ℹ ${title}${colors.reset}`);
    if (detail) {
      console.log(`${colors.dim}         ${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, "\n         ")}${colors.reset}`);
    }
  },

  isVerbose: () => VERBOSE,
};

export default log;
