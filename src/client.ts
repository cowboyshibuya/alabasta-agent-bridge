// Thin fetch wrapper over the Alabasta /agent/v1/* HTTP ingress.
// The API key encodes the workspace + principal, so no other config is needed.

export interface AlabastaConfig {
  siteUrl: string; // e.g. https://<deployment>.convex.site
  apiKey: string; // alab_sk_...
}

export class AlabastaClient {
  private readonly base: string;
  constructor(private readonly config: AlabastaConfig) {
    this.base = config.siteUrl.replace(/\/+$/, "");
  }

  async call<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.base}/agent/v1/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const message =
        (parsed as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new Error(message);
    }
    return parsed as T;
  }
}

export function configFromEnv(): AlabastaConfig {
  const siteUrl = process.env.ALABASTA_SITE_URL;
  const apiKey = process.env.ALABASTA_API_KEY;
  if (!siteUrl || !apiKey) {
    throw new Error(
      "Set ALABASTA_SITE_URL (your https://<deployment>.convex.site) and ALABASTA_API_KEY (alab_sk_...).",
    );
  }
  return { siteUrl, apiKey };
}
