export const tools = [
  {
    type: "function",
    name: "load_suspects",
    description: "Load suspect list from local dataset.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "load_power_plants",
    description: "Fetch power plant locations with plant code from Hub data endpoint.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "fetch_person_context",
    description: "Fetch observed locations and access level for one suspect.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Suspect first name.",
        },
        surname: {
          type: "string",
          description: "Suspect surname.",
        },
        birthYear: {
          type: "integer",
          description: "Suspect birth year, required by /api/accesslevel.",
        },
      },
      required: ["name", "surname", "birthYear"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "build_report",
    description: "Build deterministic report from all collected observations.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
];
