export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function requireValue(value, message, status = 400) { if (!value) throw fail(message, status); return value; }
export function requireHuman(identity) { requireValue(identity && !identity.clientId, 'This action requires your Studio session. ChatGPT can only propose changes.', 403); }
export const now = () => new Date().toISOString();
