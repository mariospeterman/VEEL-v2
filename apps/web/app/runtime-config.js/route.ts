import { readServerPublicWebEnv, serializePublicWebEnvScript } from "@/public-env";

export const dynamic = "force-dynamic";

export async function GET() {
  const script = serializePublicWebEnvScript(readServerPublicWebEnv(process.env));

  return new Response(script, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'",
      "Content-Type": "application/javascript; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
