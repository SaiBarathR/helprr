type PositiveIntParamOptions = {
  defaultValue: number;
  min?: number;
  max?: number;
};

export function parsePositiveIntParam(
  value: string | null,
  { defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER }: PositiveIntParamOptions
): number | null {
  const parsed = value === null ? defaultValue : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < min) {
    return null;
  }

  return Math.min(parsed, max);
}
