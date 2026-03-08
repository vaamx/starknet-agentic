import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://hivecaster.vercel.app";

  return [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/markets`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/fleet`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/portfolio`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/souk`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/provework`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/starkmint`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/guilds`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
  ];
}
