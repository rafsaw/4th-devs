import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.resolve(MODULE_DIR, "..", "raport.json");

const EARTH_RADIUS_KM = 6371;

const toRadians = (value) => (value * Math.PI) / 180;

const haversineKm = (pointA, pointB) => {
  const lat1 = toRadians(pointA.lat);
  const lon1 = toRadians(pointA.lon);
  const lat2 = toRadians(pointB.lat);
  const lon2 = toRadians(pointB.lon);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = (
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  );

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

const findNearestPlant = (location, plants) => {
  let nearest = null;

  for (const plant of plants) {
    const distanceKm = haversineKm(location, plant);
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = {
        code: plant.code,
        name: plant.name,
        lat: plant.lat,
        lon: plant.lon,
        distanceKm,
      };
    }
  }

  return nearest;
};

const roundDistance = (distanceKm) => Number(distanceKm.toFixed(3));

export const buildAnalysisReport = ({ suspects, plants, observations }) => {
  if (!Array.isArray(suspects) || suspects.length === 0) {
    throw new Error("Cannot build report without suspects.");
  }

  if (!Array.isArray(plants) || plants.length === 0) {
    throw new Error("Cannot build report without power plant locations.");
  }

  const candidates = observations.map((observation) => {
    const nearestHits = observation.locations.map((location) => ({
      location,
      nearestPlant: findNearestPlant(location, plants),
    }));

    const bestHit = nearestHits.reduce((best, current) => {
      if (!best) {
        return current;
      }

      return current.nearestPlant.distanceKm < best.nearestPlant.distanceKm ? current : best;
    }, null);

    return {
      name: observation.name,
      surname: observation.surname,
      birthYear: observation.birthYear,
      accessLevel: observation.accessLevel,
      apiLocations: observation.apiLocations ?? [],
      checkedLocations: observation.locations.length,
      bestHit: {
        powerPlant: bestHit?.nearestPlant.code ?? null,
        distanceKm: bestHit ? roundDistance(bestHit.nearestPlant.distanceKm) : null,
        location: bestHit?.location ?? null,
      },
      matches: nearestHits.map((item) => ({
        powerPlant: item.nearestPlant.code,
        distanceKm: roundDistance(item.nearestPlant.distanceKm),
        location: item.location,
      })),
    };
  });

  const bestCandidate = candidates.reduce((best, current) => {
    if (!current.bestHit.powerPlant) {
      return best;
    }

    if (!best) {
      return current;
    }

    if (current.bestHit.distanceKm < best.bestHit.distanceKm) {
      return current;
    }

    return best;
  }, null);

  if (!bestCandidate) {
    throw new Error("No candidate has any location observations.");
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      suspectsCount: suspects.length,
      observationsCount: observations.length,
      powerPlantCount: plants.length,
    },
    candidates,
    winner: {
      name: bestCandidate.name,
      surname: bestCandidate.surname,
      accessLevel: bestCandidate.accessLevel,
      powerPlant: bestCandidate.bestHit.powerPlant,
      distanceKm: bestCandidate.bestHit.distanceKm,
      birthYear: bestCandidate.birthYear,
    },
  };
};

export const saveReportToFile = async (report, outputPath = REPORT_PATH) => {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return outputPath;
};

export const getDefaultReportPath = () => REPORT_PATH;
