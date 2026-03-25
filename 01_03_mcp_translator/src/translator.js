/**
 * Folder-based translation loop (MCP + agent)
 *
 * What this file does
 * -------------------
 * Periodically lists files under the configured **source** directory (`translate/` by default), compares
 * with the **target** directory (`translated/`), and for each name that exists only in source, invokes
 * the same `run()` agent used by the HTTP API with a natural-language prompt: translate path A to path B.
 * The agent performs reads/writes via **MCP tools** (`fs_read`, `fs_manage`), not Node `fs` here.
 *
 * This is **polling** (`setInterval` + `config.pollInterval`), not OS file watchers (`fs.watch`).
 * On startup, `ensureDirectories` creates source/target via `fs_manage` if missing.
 *
 * Architecture (how this fits the app)
 * ------------------------------------
 * - **Two triggers** in the app: this loop (drop files in `workspace/translate/`) and `POST` routes in
 *   `server.js`. Both call `run()` with the shared `mcpClient` / `mcpTools` from `app.js`.
 * - **Paths** in prompts are relative to the MCP server’s sandbox (see `FS_ROOT` in `mcp.json`), matching
 *   `config.sourceDir` / `config.targetDir` in `config.js`.
 * - **Concurrency guard**: `inProgress` prevents overlapping work on the same filename; `loggedSkipped`
 *   avoids spamming logs when a long translation is still running across ticks.
 *
 * Production considerations
 * -------------------------
 * - **`MAX_TRANSLATIONS`**: hard cap (default 3) to limit cost or demo scope; after the cap the loop stops
 *   scheduling new work until the process restarts. Tune or remove for long-running production use.
 * - **Polling**: fixed interval hits MCP on every tick even when idle; acceptable for small folders, but
 *   noisy at scale — consider backoff, debouncing, or real watchers if requirements change.
 * - **Errors**: `listFiles` swallows errors and returns `[]`, so MCP glitches look like “no files” until
 *   the next successful tick. The outer `tick()` logs watch-loop errors.
 * - **Single process**: assumes one translator instance per workspace to avoid duplicate translations and
 *   conflicting writes to the same target files.
 */

import { translator as config } from "./config.js";
import { run } from "./agent.js";
import { callMcpTool } from "./mcp/client.js";
import log from "./helpers/logger.js";
import { logStats } from "./helpers/stats.js";

/** Demo / safety cap; loop stops enqueueing new files once reached (restart process to reset). */
const MAX_TRANSLATIONS = 3;

const inProgress = new Set();
const loggedSkipped = new Set();
let completedCount = 0;

/**
 * Lists directory entries via MCP `fs_read` (mode `list`). Optional extension filter uses `config.supportedExtensions`.
 */
const listFiles = async (mcpClient, dir, filterByExtension = false) => {
  try {
    const result = await callMcpTool(mcpClient, "fs_read", { path: dir, mode: "list" });
    if (!result.entries) return [];
    
    const getName = (e) => e.name || e.path?.split(/[/\\]/).pop();
    
    return result.entries
      .filter(e => e.kind === "file" || e.type === "file")
      .filter(e => !filterByExtension || config.supportedExtensions.some(ext => getName(e)?.endsWith(ext)))
      .map(getName);
  } catch {
    return [];
  }
};

/**
 * Runs one translation: builds a path-focused prompt and delegates to `run()` (LLM + MCP tools).
 */
const translateFile = async (filename, mcpClient, mcpTools) => {
  // Skip if already in progress (only log once per file)
  if (inProgress.has(filename)) {
    if (!loggedSkipped.has(filename)) {
      log.debug(`${filename} - translation in progress, waiting...`);
      loggedSkipped.add(filename);
    }
    return null;
  }
  
  // Clear the "logged skipped" flag when starting fresh
  loggedSkipped.delete(filename);
  inProgress.add(filename);
  
  const sourcePath = `${config.sourceDir}/${filename}`;
  const targetPath = `${config.targetDir}/${filename}`;
  
  log.info(`📄 Translating: ${filename}`);
  
  const prompt = `Translate "${sourcePath}" to English and save to "${targetPath}".`;

  try {
    const result = await run(prompt, { mcpClient, mcpTools });
    completedCount++;
    log.success(`✅ Translated: ${filename} (${completedCount}/${MAX_TRANSLATIONS})`);
    logStats();
    return result;
  } catch (error) {
    log.error(`Translation failed: ${filename}`, error.message);
    return null;
  } finally {
    inProgress.delete(filename);
  }
};

/**
 * Creates `sourceDir` and `targetDir` under the MCP roots if they do not exist (`fs_manage` mkdir).
 */
const ensureDirectories = async (mcpClient) => {
  try {
    await callMcpTool(mcpClient, "fs_manage", {
      operation: "mkdir",
      path: config.sourceDir,
      recursive: true
    });
  } catch { /* ignore */ }
  
  try {
    await callMcpTool(mcpClient, "fs_manage", {
      operation: "mkdir", 
      path: config.targetDir,
      recursive: true
    });
  } catch { /* ignore */ }
};

/**
 * Polls source vs target forever (after an initial `tick`): pending = in source, not yet in target.
 */
export const runTranslationLoop = async (mcpClient, mcpTools) => {
  log.start(`Watching ${config.sourceDir} (every ${config.pollInterval}ms)`);
  log.info(`Output: ${config.targetDir}`);
  
  await ensureDirectories(mcpClient);
  
  const tick = async () => {
    try {
      const sourceFiles = await listFiles(mcpClient, config.sourceDir, true);
      const translatedFiles = await listFiles(mcpClient, config.targetDir);
      // Same basename in translated/ means "done" for this demo (no content hash / mtime check).
      const pending = sourceFiles.filter(f => !translatedFiles.includes(f));

      for (const filename of pending) {
        if (completedCount >= MAX_TRANSLATIONS) {
          log.warn(`Reached translation limit (${MAX_TRANSLATIONS}). Restart the script to continue.`);
          return;
        }
        await translateFile(filename, mcpClient, mcpTools);
      }
    } catch (error) {
      log.error("Watch loop error", error.message);
    }
  };
  
  // Initial run
  await tick();
  
  // Start polling
  setInterval(tick, config.pollInterval);
};
