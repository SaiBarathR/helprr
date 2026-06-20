import http from 'http';
import https from 'https';

// Shared keep-alive agents for every polled Axios client (Sonarr/Radarr/Lidarr,
// Prowlarr, qBittorrent, Jellyfin). A new client is created per request and per
// polling fan-out, and Node's default global agent does NOT keep sockets alive —
// so every call paid a fresh TCP/TLS handshake. These module-level agents pool
// sockets per origin across all client instances, so the frequent
// multi-instance fan-outs reuse connections (mirrors the web-push agent in
// notification-service.ts).
export const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
export const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
