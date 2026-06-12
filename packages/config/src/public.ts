import { z } from "zod";

const publicBooleanSchema = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .default(false)
  .transform((value) => value === true || value === "true");

export const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_ENABLE_E2E_AUTH: publicBooleanSchema
});

export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;

export const parsePublicWebEnv = (env: NodeJS.ProcessEnv): PublicWebEnv => publicWebEnvSchema.parse(env);
