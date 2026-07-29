import type { WidgetDefinition, WidgetService } from './types';

export function hasRequiredWidgetServices(
  definition: Pick<WidgetDefinition, 'requiredServices' | 'requiredServiceMode'>,
  configuredServices: ReadonlySet<WidgetService>,
): boolean {
  const required = definition.requiredServices;
  if (!required?.length) return true;
  return definition.requiredServiceMode === 'any'
    ? required.some((service) => configuredServices.has(service))
    : required.every((service) => configuredServices.has(service));
}

export function describeRequiredWidgetServices(
  definition: Pick<WidgetDefinition, 'requiredServices' | 'requiredServiceMode'>,
): string {
  const required = definition.requiredServices ?? [];
  return required.join(definition.requiredServiceMode === 'any' ? ' or ' : ' and ');
}
