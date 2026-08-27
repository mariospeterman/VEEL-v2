export function safeProviderImageSource(source: string | undefined) {
  if (!source) return undefined;
  return /^data:image\/(?:png|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(source)
    ? source
    : undefined;
}
