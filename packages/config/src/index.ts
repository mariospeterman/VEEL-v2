import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional()
});

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  API_URL: z.string().url().default("http://localhost:4000"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  BUNNY_STREAM_API_KEY: z.string().optional(),
  BUNNY_STREAM_LIBRARY_ID: z.string().optional(),
  LIVEPEER_API_KEY: z.string().optional(),
  AGE_VERIFICATION_DRIVER: z
    .enum(["yoti_digital_id", "yoti", "sumsub", "veriff", "persona"])
    .optional(),
  AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: z.coerce.boolean().default(false),
  SUMSUB_APP_TOKEN: z.string().optional(),
  SUMSUB_SECRET_KEY: z.string().optional(),
  SUMSUB_WEBHOOK_SECRET: z.string().optional(),
  SUMSUB_LEVEL_NAME: z.string().optional(),
  SUMSUB_API_BASE_URL: z.string().url().default("https://api.sumsub.com"),
  YOTI_SDK_ID: z.string().optional(),
  YOTI_API_TOKEN: z.string().optional(),
  YOTI_NOTIFICATION_KEY_PATH: z.string().optional(),
  YOTI_API_BASE_URL: z.string().url().default("https://age.yoti.com/api/v1"),
  YOTI_LAUNCH_BASE_URL: z.string().url().default("https://age.yoti.com"),
  VERIFF_API_KEY: z.string().optional(),
  VERIFF_SHARED_SECRET: z.string().optional(),
  VERIFF_API_BASE_URL: z.string().url().default("https://stationapi.veriff.com"),
  PERSONA_API_KEY: z.string().optional(),
  PERSONA_WEBHOOK_SECRET: z.string().optional(),
  PERSONA_TEMPLATE_ID: z.string().optional(),
  PERSONA_API_BASE_URL: z.string().url().default("https://api.withpersona.com")
});

export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const parsePublicWebEnv = (env: NodeJS.ProcessEnv): PublicWebEnv => publicWebEnvSchema.parse(env);

export const parseServerEnv = (env: NodeJS.ProcessEnv): ServerEnv => serverEnvSchema.parse(env);
