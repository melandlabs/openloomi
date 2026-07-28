export function decodeSearchParamText(
  value: string | null,
): string | undefined {
  if (value == null) return undefined;

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
