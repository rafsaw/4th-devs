export const finalSummarySchema = {
  type: "json_schema",
  name: "findhim_final_summary",
  strict: true,
  schema: {
    type: "object",
    properties: {
      winnerName: { type: "string" },
      winnerSurname: { type: "string" },
      powerPlant: { type: "string" },
      distanceKm: { type: "number" },
      accessLevel: { type: "integer" },
      reason: { type: "string" }
    },
    required: [
      "winnerName",
      "winnerSurname",
      "powerPlant",
      "distanceKm",
      "accessLevel",
      "reason"
    ],
    additionalProperties: false
  }
};