// Helprr's guides (Astro Starlight). Its own package, kept out of the app's build, lint,
// tests and image. Published to GitHub Pages from main, with a release (see
// .github/workflows/docs.yml).
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
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
        { label: 'Start here', items: ['start-here'] },
      ],
    }),
  ],
});
