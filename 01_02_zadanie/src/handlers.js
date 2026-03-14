import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuspectsFromFile } from "./people.js";
import { buildAnalysisReport, getDefaultReportPath, saveReportToFile } from "./report.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FINDHIM_LOCATIONS_PATH = path.resolve(MODULE_DIR, "..", "findhim_locations.json");

const DATA_BASE_URL = "https://hub.ag3nts.org/data";
const LOCATION_ENDPOINT = "https://hub.ag3nts.org/api/location";
const ACCESS_LEVEL_ENDPOINT = "https://hub.ag3nts.org/api/accesslevel";
const GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const geocodeCache = new Map();

const previewText = (value, maxLength = 220) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const readJsonResponse = async (response, contextLabel) => {
  const rawText = await response.text();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!rawText.trim()) {
    throw new Error(`${contextLabel}: empty response body (status ${response.status}).`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      `${contextLabel}: expected JSON but got "${contentType || "unknown"}" `
      + `(status ${response.status}). Body preview: ${previewText(rawText)}`,
    );
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(
      `${contextLabel}: invalid JSON payload (status ${response.status}). `
      + `Body preview: ${previewText(rawText)}`,
    );
  }
};

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const geocodeCityInPoland = async (city, tracer) => {
  if (geocodeCache.has(city)) {
    tracer?.record("tool.http.cache_hit", {
      source: "geocode_city",
      city,
    });
    return geocodeCache.get(city);
  }

  const query = new URLSearchParams({
    city,
    country: "Poland",
    format: "jsonv2",
    limit: "1",
  });

  const url = `${GEOCODE_ENDPOINT}?${query.toString()}`;
  tracer?.record("tool.http.request", {
    source: "geocode_city",
    method: "GET",
    url,
  });

  const response = await fetch(url, {
    headers: {
      // Nominatim requires a descriptive user-agent.
      "User-Agent": "ai-devs-4-findhim-workflow/1.0",
    },
  });

  const payload = await readJsonResponse(response, `Geocoding city ${city}`);
  tracer?.record("tool.http.response", {
    source: "geocode_city",
    method: "GET",
    url,
    status: response.status,
    ok: response.ok,
    body: payload,
  });

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`Cannot geocode city: ${city}`);
  }

  const point = {
    lat: ensureNumber(payload[0].lat, "geocode.lat"),
    lon: ensureNumber(payload[0].lon, "geocode.lon"),
  };
  geocodeCache.set(city, point);
  return point;
};

const ensureNumber = (value, fieldName) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} must be a number.`);
  }
  return number;
};

const normalizeLocation = (raw) => {
  const latitude = raw.lat ?? raw.latitude ?? raw[0];
  const longitude = raw.lon ?? raw.lng ?? raw.longitude ?? raw[1];

  return {
    lat: ensureNumber(latitude, "location.lat"),
    lon: ensureNumber(longitude, "location.lon"),
  };
};

const normalizeLocationsResponse = (payload) => {
  const list = Array.isArray(payload?.locations)
    ? payload.locations
    : Array.isArray(payload)
      ? payload
      : [];

  return list.map(normalizeLocation);
};

const getRawLocationList = (payload) => (
  Array.isArray(payload?.locations)
    ? payload.locations
    : Array.isArray(payload)
      ? payload
      : []
);

const normalizeAccessLevelResponse = (payload) => {
  const candidate = payload?.accessLevel ?? payload?.access_level ?? payload?.level ?? payload;
  const value = Number.parseInt(String(candidate), 10);

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid access level response: ${JSON.stringify(payload)}`);
  }

  return value;
};

const postHubApi = async (url, body, tracer, source) => {
  tracer?.record("tool.http.request", {
    source,
    method: "POST",
    url,
    body,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await readJsonResponse(response, `Hub endpoint ${url}`);
  tracer?.record("tool.http.response", {
    source,
    method: "POST",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });

  if (!response.ok) {
    const message = data?.message ?? data?.error?.message ?? `Hub request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
};

const fetchPowerPlants = async (apiKey, tracer) => {
  const url = `${DATA_BASE_URL}/${apiKey}/findhim_locations.json`;
  tracer?.record("tool.http.request", {
    source: "load_power_plants",
    method: "GET",
    url,
  });

  const response = await fetch(url);
  const data = await readJsonResponse(response, "Power plants dataset");
  tracer?.record("tool.http.response", {
    source: "load_power_plants",
    method: "GET",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });

  if (!response.ok) {
    const message = data?.message ?? `Power plants request failed (${response.status})`;
    throw new Error(message);
  }

  await writeFile(
    FINDHIM_LOCATIONS_PATH,
    `${JSON.stringify(data, null, 2)}\n`,
    "utf-8",
  );
  tracer?.record("file.write", {
    source: "load_power_plants",
    path: FINDHIM_LOCATIONS_PATH,
  });

  if (Array.isArray(data)) {
    return data.map((item) => ({
      code: String(item.code ?? item.powerPlant ?? item.id ?? "").trim(),
      name: String(item.name ?? item.plantName ?? item.code ?? "UnknownPlant").trim(),
      lat: ensureNumber(item.lat ?? item.latitude, "powerPlant.lat"),
      lon: ensureNumber(item.lon ?? item.lng ?? item.longitude, "powerPlant.lon"),
    })).filter((item) => item.code);
  }

  const powerPlantsByCity = data?.power_plants;
  if (!powerPlantsByCity || typeof powerPlantsByCity !== "object") {
    throw new Error("Power plants dataset has unsupported shape.");
  }

  const plants = [];
  for (const [city, details] of Object.entries(powerPlantsByCity)) {
    const point = await geocodeCityInPoland(city, tracer);
    plants.push({
      code: String(details?.code ?? "").trim(),
      name: city,
      lat: point.lat,
      lon: point.lon,
      isActive: Boolean(details?.is_active),
      power: String(details?.power ?? "").trim(),
    });
    // Be polite with free geocoding endpoint to reduce throttling risk.
    await wait(150);
  }

  return plants.filter((item) => item.code);
};

export const createHandlers = ({ apiKey, state, tracer }) => {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("apiKey must be provided for findhim workflow.");
  }

  return {
    async load_suspects() {
      const suspects = await loadSuspectsFromFile();
      state.suspects = suspects;
      return {
        suspects,
        count: suspects.length,
      };
    },

    async load_power_plants() {
      const plants = await fetchPowerPlants(apiKey, tracer);
      state.plants = plants;
      return {
        plants,
        count: plants.length,
      };
    },

    async fetch_person_context({ name, surname, birthYear }) {
      const payload = {
        apikey: apiKey,
        name,
        surname,
      };

      const locationsPayload = await postHubApi(
        LOCATION_ENDPOINT,
        payload,
        tracer,
        "fetch_person_context.location",
      );
      const accessPayload = await postHubApi(
        ACCESS_LEVEL_ENDPOINT,
        {
          ...payload,
          birthYear,
        },
        tracer,
        "fetch_person_context.accesslevel",
      );

      const entry = {
        name,
        surname,
        birthYear: Number.parseInt(String(birthYear), 10),
        apiLocations: getRawLocationList(locationsPayload),
        locations: normalizeLocationsResponse(locationsPayload),
        accessLevel: normalizeAccessLevelResponse(accessPayload),
      };

      const existingIndex = state.observations.findIndex(
        (item) => item.name === name && item.surname === surname,
      );

      if (existingIndex >= 0) {
        state.observations[existingIndex] = entry;
      } else {
        state.observations.push(entry);
      }

      return {
        entry,
      };
    },

    async build_report() {
      const report = buildAnalysisReport({
        suspects: state.suspects,
        plants: state.plants,
        observations: state.observations,
      });

      await saveReportToFile(report);
      tracer?.record("file.write", {
        source: "build_report",
        path: getDefaultReportPath(),
      });
      state.report = report;

      return report;
    },
  };
};
