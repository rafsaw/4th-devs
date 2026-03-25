/**
 * checkPackage.js — infrastructure adapter for the package status API.
 *
 * Responsibility: execute one POST to the external packages API and return
 * a normalized result. No LLM logic, no session handling — pure HTTP adapter.
 *
 * Environment variables required:
 *   PACKAGES_API_URL   — full URL of the packages API (e.g. https://hub.ag3nts.org/api/packages)
 *   AG3NTS_API_KEY     — authorization key sent as "apikey" in the request body
 */

const API_URL = process.env.PACKAGES_API_URL;
const API_KEY = process.env.AG3NTS_API_KEY;

/**
 * @param {string} packageid
 * @returns {object} raw API response (status, location, etc.)
 */
export const checkPackage = async (packageid) => {
  if (!API_URL || !API_KEY) {
    throw new Error("PACKAGES_API_URL and AG3NTS_API_KEY must be set");
  }

  console.log(`[checkPackage] → packageid=${packageid}`);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, action: "check", packageid }),
  });

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.message ?? `API error (${response.status})`;
    console.error(`[checkPackage] ✗ ${msg}`);
    throw new Error(msg);
  }

  console.log(`[checkPackage] ←`, JSON.stringify(data));
  return data;
};
