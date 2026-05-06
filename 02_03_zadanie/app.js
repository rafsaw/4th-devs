/**
 * Zadanie s02e03 — failure: kompresja logów + iteracja z feedbackiem hub.ag3nts.org/verify.
 * Sukces: odpowiedź zawiera flagę {FLG:…} — patrz 02_03_zadanie_podejscie.md
 */

import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLAG_FILE = join(__dirname, "workspace", "failure-flg.txt");

/** Gdy nie używasz `npm start`, zmienne z root `.env` są wczytywane poniżej (`../.env`). */
const loadRootEnvIfNeeded = () => {
  const p = join(__dirname, "..", ".env");
  if (!existsSync(p)) return;
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
};

loadRootEnvIfNeeded();

const HUB_ORIGIN = "https://hub.ag3nts.org";
const TASK = "failure";
const MAX_TOKENS_ESTIMATE = 1500;
/** Konserwatywny szacunek tokenów (znaki/3) — patrz spec */
const estimateTokens = (text) => Math.ceil((text ?? "").length / 3);

const SEVERITY_RE = /\[(CRIT|ERRO|WARN)\]/;

const apikey = (process.env.AG3NTS_API_KEY ?? process.env.AG3NTS_APIKEY)?.trim();
if (!apikey) {
  console.error(
    "Brak AG3NTS_API_KEY (hub). Ustaw w pliku .env w katalogu głównym repozytorium (../.env) lub w środowisku. (Dopuszczalny alias: AG3NTS_APIKEY.)",
  );
  process.exit(1);
}

/** Cały surowy plik — nawigacja przez search only; nie wysyłamy tego do Centrali. */
let rawLines = [];

const searchLog = (pattern) => {
  let re;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  return rawLines.filter((line) => re.test(line));
};

const responseToSearchText = (data) => {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

const extractFlag = (text) => {
  const m = String(text).match(/\{FLG:[^}]+\}/);
  return m ? m[0] : null;
};

const saveFlagToProject = async (flag, verifyPayload) => {
  await mkdir(join(__dirname, "workspace"), { recursive: true });
  const appendix =
    typeof verifyPayload === "string" ? verifyPayload : JSON.stringify(verifyPayload, null, 2);
  await writeFile(
    FLAG_FILE,
    `${flag}\n\n---\nPełna odpowiedź verify:\n${appendix}\n`,
    "utf8",
  );
  console.log("Flaga zapisana w projekcie:", FLAG_FILE);
};

/**
 * Wyciąga potencjalne identyfikatory podzespołów z feedbacku (np. PUMP03, WTANK07).
 */
const extractHints = (feedback) => {
  const s = responseToSearchText(feedback);
  const terms = new Set();
  const idRe = /\b[A-Z][A-Z0-9]{1,}\d{1,3}\b/g;
  let m;
  while ((m = idRe.exec(s)) !== null) {
    const t = m[0];
    if (t !== "FLG" && t.length >= 4) terms.add(t);
  }
  return [...terms];
};

const parseLineMeta = (line) => {
  const sev = line.match(SEVERITY_RE);
  const level = sev ? sev[1] : "ZZZ";
  const ts = line.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\]/);
  const timeKey = ts ? `${ts[1]} ${ts[2].padStart(5, "0")}` : line;
  const rank = level === "CRIT" ? 0 : level === "ERRO" ? 1 : level === "WARN" ? 2 : 3;
  return { rank, timeKey, line };
};

const sortLines = (lines) =>
  [...lines].sort((a, b) => {
    const A = parseLineMeta(a);
    const B = parseLineMeta(b);
    if (A.rank !== B.rank) return A.rank - B.rank;
    return A.timeKey.localeCompare(B.timeKey);
  });

/** Skraca opis po tagu poziomu, zachowując timestamp + CRIT/WARN/… */
const trimLineMessage = (line, maxLen) => {
  const m = line.match(/^(\[[^\]]+\]\s+)(\[[^\]]+\]\s+)(.+)$/);
  if (!m) return line.slice(0, maxLen);
  const prefix = m[1] + m[2];
  let rest = m[3];
  const budget = Math.max(20, maxLen - prefix.length);
  if (rest.length <= budget) return prefix + rest;
  return prefix + rest.slice(0, budget - 3) + "...";
};

const greedyPackUnderBudget = (lines, maxTok) => {
  const sorted = sortLines(lines);
  const picked = [];
  for (const line of sorted) {
    const next = picked.length ? `${picked.join("\n")}\n${line}` : line;
    if (estimateTokens(next) <= maxTok) picked.push(line);
  }
  if (picked.length === 0 && sorted.length > 0) {
    let one = sorted[0];
    while (estimateTokens(one) > maxTok && one.length > 40) {
      one = trimLineMessage(one, Math.max(60, Math.floor(one.length * 0.88)));
    }
    picked.push(one);
  }
  return picked;
};

/**
 * Jeśli nadal za dużo — skraca najdłuższe komunikaty, potem usuwa najniższy priorytet (WARN).
 */
const fitUnderTokenBudget = (lines, maxTok = MAX_TOKENS_ESTIMATE) => {
  let working = [...new Set(lines)].filter(Boolean);
  let guard = 0;
  while (guard++ < 5000) {
    const body = working.join("\n");
    const et = estimateTokens(body);
    if (et <= maxTok) return working;

    const shortened = working.map((ln) => trimLineMessage(ln, Math.min(220, Math.floor(ln.length * 0.85) || 120)));
    if (shortened.join("\n") === body) {
      const sorted = sortLines(working);
      const dropIdx = sorted.findLastIndex((l) => SEVERITY_RE.test(l) && l.includes("[WARN]"));
      if (dropIdx === -1) {
        working = sorted.slice(0, -1);
        if (working.length === 0) break;
        continue;
      }
      const toDrop = sorted[dropIdx];
      working = working.filter((l) => l !== toDrop);
      continue;
    }
    working = shortened;
  }
  return working.slice(0, Math.max(1, working.length - 1));
};

const fetchFailureLog = async () => {
  const url = `${HUB_ORIGIN}/data/${encodeURIComponent(apikey)}/failure.log`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET failure.log: ${res.status} ${await res.text()}`);
  const text = await res.text();
  rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  console.log(`Pobrano failure.log: ${rawLines.length} linii, ~${estimateTokens(text)} tokenów (szac.)`);
};

const verify = async (logs) => {
  const res = await fetch(`${HUB_ORIGIN}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey,
      task: TASK,
      answer: { logs },
    }),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { ok: res.ok, status: res.status, data, raw };
};

const buildInitialPool = () => {
  const sev = rawLines.filter((l) => SEVERITY_RE.test(l));
  let pool = sev;
  const joined = () => pool.join("\n");
  if (estimateTokens(joined()) > MAX_TOKENS_ESTIMATE) {
    pool = sev.filter((l) => /\[CRIT\]|\[ERRO\]/.test(l));
  }
  return pool;
};

const main = async () => {
  await fetchFailureLog();

  let candidateLines = buildInitialPool();
  candidateLines = fitUnderTokenBudget(greedyPackUnderBudget(candidateLines, MAX_TOKENS_ESTIMATE));
  let logsPayload = candidateLines.join("\n");

  const maxIter = 30;
  for (let i = 1; i <= maxIter; i++) {
    if (estimateTokens(logsPayload) > MAX_TOKENS_ESTIMATE) {
      candidateLines = fitUnderTokenBudget(candidateLines, MAX_TOKENS_ESTIMATE);
      logsPayload = candidateLines.join("\n");
    }

    console.log(`\n--- Iteracja ${i} · ~${estimateTokens(logsPayload)} tok (szac.) · ${candidateLines.length} linii ---`);
    const { ok, status, data, raw } = await verify(logsPayload);
    const text = responseToSearchText(data ?? raw);

    const flag = extractFlag(text);
    if (flag) {
      console.log("\nSukces — Centrala zwróciła flagę:", flag);
      console.log("Pełna odpowiedź:", typeof data === "string" ? data : JSON.stringify(data, null, 2));
      await saveFlagToProject(flag, data ?? raw);
      return;
    }

    console.log(`Odpowiedź verify (HTTP ${status}${ok ? "" : " — błąd"}):`, text.slice(0, 1500) + (text.length > 1500 ? "…" : ""));

    const hints = extractHints(data ?? raw);
    let added = 0;
    for (const term of hints) {
      for (const line of searchLog(term)) {
        if (!candidateLines.includes(line)) {
          candidateLines.push(line);
          added++;
        }
      }
    }

    if (added === 0 && hints.length > 0) {
      const alt = searchLog(hints.join("|"));
      for (const line of alt) {
        if (!candidateLines.includes(line)) {
          candidateLines.push(line);
          added++;
        }
      }
    }

    candidateLines = fitUnderTokenBudget(greedyPackUnderBudget(candidateLines, MAX_TOKENS_ESTIMATE));
    logsPayload = candidateLines.join("\n");

    if (added === 0) {
      console.warn(
        "\nBrak nowych linii z podpowiedzi — rozszerzam zbiór: wszystkie CRIT/ERRO/WARN (potem przycięcie do budżetu).",
      );
      candidateLines = fitUnderTokenBudget(
        greedyPackUnderBudget(buildInitialPool(), MAX_TOKENS_ESTIMATE),
        MAX_TOKENS_ESTIMATE,
      );
      logsPayload = candidateLines.join("\n");
    }
  }

  console.error("\nPrzekroczono limit iteracji bez {FLG:…}. Sprawdź ostatnią odpowiedź Centrali i dopasuj heurystyki.");
  process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
