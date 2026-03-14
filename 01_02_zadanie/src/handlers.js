import { loadSuspectsFromFile } from "./people.js";
import { buildAnalysisReport, saveReportToFile } from "./report.js";

const DATA_BASE_URL = "https://hub.ag3nts.org/data";
const LOCATION_ENDPOINT = "https://hub.ag3nts.org/api/location";
const ACCESS_LEVEL_ENDPOINT = "https://hub.ag3nts.org/api/accesslevel";

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

const normalizeAccessLevelResponse = (payload) => {
  const candidate = payload?.accessLevel ?? payload?.access_level ?? payload?.level ?? payload;
  const value = Number.parseInt(String(candidate), 10);

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid access level response: ${JSON.stringify(payload)}`);
  }

  return value;
};

const postHubApi = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message ?? data?.error?.message ?? `Hub request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
};

const fetchPowerPlants = async (apiKey) => {
  const response = await fetch(`${DATA_BASE_URL}/${apiKey}/findhim_locations.json`);
  const data = await response.json();

  if (!response.ok) {
    const message = data?.message ?? `Power plants request failed (${response.status})`;
    throw new Error(message);
  }

  if (!Array.isArray(data)) {
    throw new Error("Power plants dataset must be an array.");
  }

  return data.map((item) => ({
    code: String(item.code ?? item.powerPlant ?? item.id ?? "").trim(),
    name: String(item.name ?? item.plantName ?? item.code ?? "UnknownPlant").trim(),
    lat: ensureNumber(item.lat ?? item.latitude, "powerPlant.lat"),
    lon: ensureNumber(item.lon ?? item.lng ?? item.longitude, "powerPlant.lon"),
  })).filter((item) => item.code);
};

export const createHandlers = ({ apiKey, state }) => {
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
      const plants = await fetchPowerPlants(apiKey);
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

      const locationsPayload = await postHubApi(LOCATION_ENDPOINT, payload);
      const accessPayload = await postHubApi(ACCESS_LEVEL_ENDPOINT, {
        ...payload,
        birthYear,
      });

      const entry = {
        name,
        surname,
        birthYear: Number.parseInt(String(birthYear), 10),
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
      state.report = report;

      return report;
    },
  };
};
