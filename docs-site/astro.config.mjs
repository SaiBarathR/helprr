// Helprr's guides (Astro Starlight). Its own package, kept out of the app's build, lint,
// tests and image. Published to GitHub Pages from main, with a release (see
// .github/workflows/docs.yml).
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  // The configurator reads the repository's docker-compose.yml.
  vite: { server: { fs: { allow: ['.', '../docker-compose.yml'] } } },
  site: 'https://saibarathr.github.io',
  base: '/helprr',
  integrations: [
    starlight({
      title: 'Helprr',
      description: 'Set up Helprr: install it, connect your apps, get push on your phone.',
      logo: { src: './src/assets/helprr.png', alt: 'Helprr' },
      favicon: '/favicon.png',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/SaiBarathR/helprr' }],
      editLink: { baseUrl: 'https://github.com/SaiBarathR/helprr/edit/development/docs-site/' },
      customCss: ['./src/styles/helprr.css'],
      sidebar: [
        { label: 'Start here', items: ['start-here', 'install/configurator', 'install/demo'] },
        { label: 'Install', items: ['install/one-command', 'install/compose-only', 'install/manual', 'install/portainer', 'install/casaos', 'install/runtipi', 'install/truenas', 'install/proxmox', 'install/windows', 'first-run'] },
        {
          label: 'Connect your apps',
          items: ['connect', 'connect/sonarr', 'connect/radarr', 'connect/lidarr', 'connect/qbittorrent', 'connect/prowlarr', 'connect/jellyfin', 'connect/seerr', 'connect/tmdb'],
        },
        { label: 'Use it', items: ['phone-and-push', 'https', 'people', 'twitch', 'youtube'] },
        { label: 'Look after it', items: ['maintain/update', 'maintain/backup', 'maintain/uninstall', 'troubleshooting'] },
        { label: 'Reference', items: ['reference/environment', 'reference/cache', 'reference/deleting-files', 'reference/privacy', 'reference/security'] },
        { label: 'Contributing', items: ['contributing'] },
      ],
    }),
  ],
});
