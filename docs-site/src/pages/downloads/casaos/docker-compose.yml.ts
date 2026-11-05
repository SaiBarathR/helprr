// The CasaOS Compose file (install/casaos), made from the release's docker-compose.yml.
import release from '../../../../../docker-compose.yml?raw';
import { casaosCompose } from '../../../lib/app-store-compose.mjs';

export function GET() {
  return new Response(casaosCompose(release), { headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
}
