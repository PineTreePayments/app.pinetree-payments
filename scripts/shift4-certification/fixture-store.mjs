export class Shift4FixtureStore {
  constructor() { this.attempts = []; this.journal = []; this.sessions = new Map(); this.providerRequestsSent = 0 }
  prepareSession(caseId) { const id = `${caseId}-session`; this.sessions.set(id, "created"); return id }
  consumeSession(id) { const state = this.sessions.get(id); if (state === "consumed") return "already_consumed"; if (state !== "created") return "unavailable"; this.sessions.set(id, "consumed"); return "consumed_now" }
  recordAttempt(value) { this.attempts.push(Object.freeze(value)); return value.id }
  recordJournal(value) { if (!this.journal.some((row) => row.postingKey === value.postingKey)) this.journal.push(Object.freeze(value)); return value.postingKey }
}
