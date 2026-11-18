// How long a service must stay unreachable before its "down" alert
// (AppSettings.serviceDownAlertDelaySecs). Dependency-free so the settings
// page, API, import and poller share it.
export const DEFAULT_SERVICE_DOWN_ALERT_DELAY_SECS = 120;
export const MAX_SERVICE_DOWN_ALERT_DELAY_SECS = 3600;
