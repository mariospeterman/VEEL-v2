import type { MetadataRoute } from "next";
import { legalDocSlugs } from "./legal-docs";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return [
    { url: appUrl, changeFrequency: "weekly", priority: 1 },
    ...legalDocSlugs.map((slug) => ({
      url: `${appUrl}/legal/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.3
    }))
  ];
}
