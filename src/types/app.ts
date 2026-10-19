// App Types
export interface ServiceConnectionConfig {
  type: 'SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN' | 'TMDB' | 'SEERR' | 'LIDARR';
  url: string;
  apiKey: string;
}

export interface NotificationEvent {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
}
