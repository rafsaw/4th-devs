/**
 * memory.js — in-process conversation memory keyed by sessionID.
 *
 * Responsibility: store and retrieve per-session message history.
 * Each session is an array of Responses-API-format message objects.
 * No persistence — state lives only as long as the process runs.
 *
 * Exports:
 *   getHistory(sessionID)           → messages[] for that session (creates empty if new)
 *   appendMessages(sessionID, msgs) → push one or more messages into the session history
 *   clearSession(sessionID)         → wipe a session (optional utility)
 */

const sessions = new Map();

export const getHistory = (sessionID) => {
  if (!sessions.has(sessionID)) sessions.set(sessionID, []);
  return sessions.get(sessionID);
};

export const appendMessages = (sessionID, messages) => {
  const history = getHistory(sessionID);
  history.push(...messages);
};

export const clearSession = (sessionID) => sessions.delete(sessionID);
