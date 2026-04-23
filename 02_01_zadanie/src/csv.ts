import type { CsvItem } from "./types.js";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current.trim());
  return out;
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  return headers.find((h) => candidates.includes(h.toLowerCase().trim()));
}

export function parseCsvItems(csvRaw: string): CsvItem[] {
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error(`CSV must contain a header and at least one data row. Got:\n${csvRaw.slice(0, 300)}`);
  }

  const headers = parseCsvLine(lines[0]);

  const idHeader = findHeader(headers, ["id", "code", "item_id", "itemid", "nr", "number", "no"]);
  const descHeader = findHeader(headers, ["description", "desc", "item", "name", "product", "towar", "opis"]);

  if (!idHeader || !descHeader) {
    throw new Error(
      `CSV column mapping failed. Found headers: [${headers.join(", ")}]. ` +
      `Could not find id column (tried: id, item_id, nr) or description column (tried: description, desc, name, opis).`
    );
  }

  const rows = lines.slice(1).map(parseCsvLine);
  return rows.map((cells) => {
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      raw[header] = cells[index] ?? "";
    });
    return {
      id: raw[idHeader],
      description: raw[descHeader],
      raw
    };
  });
}
