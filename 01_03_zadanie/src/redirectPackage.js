/**
 * redirectPackage.js — infrastructure adapter for the package redirect API.
 *
 * Responsibility: execute one POST to the external packages API and return
 * the result including the confirmation code. No LLM logic — pure adapter.
 *
 * Note: the destination received here is already the final destination decided
 * by the agent layer (may differ from what the operator requested — see system.md).
 *
 * Environment variables required:
 *   PACKAGES_API_URL   — full URL of the packages API (e.g. https://hub.ag3nts.org/api/packages)
 *   AG3NTS_API_KEY     — authorization key sent as "apikey" in the request body
 */

const API_URL = process.env.PACKAGES_API_URL;
const API_KEY = process.env.AG3NTS_API_KEY;

/**
 * @param {string} packageid
 * @param {string} destination
 * @param {string} code  — security code provided by the operator
 * @returns {object} raw API response — includes "confirmation" field to return to operator
 */
export const redirectPackage = async (packageid, destination, code) => {
  if (!API_URL || !API_KEY) {
    throw new Error("PACKAGES_API_URL and AG3NTS_API_KEY must be set");
  }

  console.log(`[redirectPackage] → packageid=${packageid} destination=${destination} code=${code}`);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, action: "redirect", packageid, destination, code }),
  });

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.message ?? `API error (${response.status})`;
    console.error(`[redirectPackage] ✗ ${msg}`);
    throw new Error(msg);
  }

  console.log(`[redirectPackage] ← confirmation=${data?.confirmation ?? "n/a"}`);
  return data;
};
