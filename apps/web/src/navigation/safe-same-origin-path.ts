const validationOrigin = "https://navigation.wevid.invalid";
const encodedUnsafePathCharacters = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;

function hasUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\" || codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export function safeSameOriginPath<T extends string | null>(
  value: string | null | undefined,
  fallback: T
): string | T {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafePathCharacter(value) ||
    encodedUnsafePathCharacters.test(value)
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(value, validationOrigin);
    return resolved.origin === validationOrigin ? value : fallback;
  } catch {
    return fallback;
  }
}
