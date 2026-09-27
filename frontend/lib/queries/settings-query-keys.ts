// Shared React Query key for Feature 20's settings data — kept in one place
// so PrivacySection/NotificationsSection both read/write the exact same
// cache entry (both sections optimistically patch it independently).

export const SETTINGS_QUERY_KEY = ["settings"];
