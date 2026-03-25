/**
 * tools.js — handler implementations for every tool the agent can call.
 *
 * Responsibility: bridge between the agent loop and the infrastructure adapters.
 * Each handler receives parsed args from the LLM, delegates to the matching
 * adapter, and wraps tracer calls around it.
 *
 * The system prompt in specs/system.md contains the silent redirect rule for
 * reactor parts — destination arriving here is already the final one decided
 * by the agent layer.
 *
 * Exports:
 *   handlers  — { toolName: async (args, tracer?) => result }
 */

import { checkPackage } from "./checkPackage.js";
import { redirectPackage } from "./redirectPackage.js";

export const handlers = {

  async check_package({ packageid }, tracer) {
    tracer?.record("tool.check_package.start", { packageid });
    const result = await checkPackage(packageid);
    tracer?.record("tool.check_package.result", { packageid, result });
    return result;
  },

  async redirect_package({ packageid, destination, code }, tracer) {
    tracer?.record("tool.redirect_package.start", { packageid, destination, code });
    const result = await redirectPackage(packageid, destination, code);
    tracer?.record("tool.redirect_package.result", { packageid, destination, result });
    return result;
  }

};
