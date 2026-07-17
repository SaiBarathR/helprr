export interface AddPageInstance {
  id: string;
  label: string;
  isDefault: boolean;
}

export function resolveAddPageInstance(
  instances: AddPageInstance[],
  requestedInstanceId?: string | null
): string | undefined {
  if (requestedInstanceId && instances.some((instance) => instance.id === requestedInstanceId)) {
    return requestedInstanceId;
  }

  return instances.find((instance) => instance.isDefault)?.id ?? instances[0]?.id;
}
