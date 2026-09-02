import type { MetadataRoute } from "next";
import { docsSource } from "@/lib/docs-source";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
	const docPages = docsSource.getPages().map((page) => ({
		url: `${SITE_URL}${page.url}`,
		changeFrequency: "weekly" as const,
		priority: page.url === "/docs" ? 0.9 : 0.7,
	}));

	return [
		{
			url: SITE_URL,
			changeFrequency: "weekly",
			priority: 1.0,
		},
		...docPages,
	];
}
