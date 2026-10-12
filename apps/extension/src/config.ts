// VITE_SERVER_URL feeds this origin and manifest host permissions at build time.
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3456";

// Feature requests use /api; dashboard navigation uses the bare origin.
export const API_BASE_URL = `${SERVER_URL}/api`;
