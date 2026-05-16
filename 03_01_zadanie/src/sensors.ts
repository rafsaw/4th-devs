const FIELD_MAP: Record<string, string> = {
  temperature: "temperature_K",
  pressure: "pressure_bar",
  water: "water_level_meters",
  voltage: "voltage_supply_v",
  humidity: "humidity_percent",
};

const RANGES: Record<string, readonly [number, number]> = {
  temperature_K: [553, 873],
  pressure_bar: [60, 160],
  water_level_meters: [5.0, 15.0],
  voltage_supply_v: [229.0, 231.0],
  humidity_percent: [40.0, 80.0],
};

const ALL_FIELDS = new Set(Object.keys(RANGES));

function getActiveFields(sensorType: string): Set<string> {
  const parts = sensorType.split("/").map((p) => p.trim().toLowerCase());
  const active = new Set<string>();
  for (const p of parts) {
    const key = FIELD_MAP[p];
    if (key) active.add(key);
  }
  return active;
}

/**
 * True if sensor readings are anomalous: active field out of range,
 * or inactive field not exactly 0.
 */
export function hasDataAnomaly(data: Record<string, unknown>): boolean {
  const sensorType = String(data.sensor_type ?? "");
  const active = getActiveFields(sensorType);

  for (const field of ALL_FIELDS) {
    const raw = data[field];
    const value = raw == null ? 0.0 : Number(raw);

    if (active.has(field)) {
      const range = RANGES[field];
      if (!range) continue;
      const [lo, hi] = range;
      if (!(lo <= value && value <= hi)) return true;
    } else if (value !== 0.0) {
      return true;
    }
  }

  return false;
}
