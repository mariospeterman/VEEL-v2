export type AdminSearchParams = Record<string, string | string[] | undefined>;

export function adminApiPagePath(path: string, cursor?: string): string {
  if (!cursor) return path;
  const params = new URLSearchParams({ cursor });
  return `${path}?${params.toString()}`;
}

export function adminSearchParam(
  searchParams: AdminSearchParams,
  key: string
): string | undefined {
  const value = searchParams[key];
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar && scalar.length <= 4_096 ? scalar : undefined;
}

export function preservedAdminSearchEntries(
  searchParams: AdminSearchParams,
  excluded: string[]
): Array<[string, string]> {
  const excludedKeys = new Set(excluded);
  return Object.keys(searchParams)
    .sort()
    .flatMap((key) => {
      if (excludedKeys.has(key)) return [];
      const value = adminSearchParam(searchParams, key);
      return value ? [[key, value] as [string, string]] : [];
    });
}

export function adminSectionPageHref(input: {
  section: string;
  searchParams: AdminSearchParams;
  cursorKey: string;
  cursor: string;
}): string {
  const params = new URLSearchParams(
    preservedAdminSearchEntries(input.searchParams, [input.cursorKey])
  );
  params.set(input.cursorKey, input.cursor);
  return `/admin/${encodeURIComponent(input.section)}?${params.toString()}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
