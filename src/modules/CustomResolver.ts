export interface CustomResolver {
  name: string;
  method: "GET" | "POST";
  url: string;
  mode: "html" | "json";
  selector: string;
  automatic?: boolean;
  attribute?: string;
  index?: number;
  mappings?: {
    url?: string;
    pageURL?: string;
  };
}

export function isCustomResolverEqual(a: CustomResolver, b: CustomResolver) {
  return (
    a.name === b.name &&
    a.method === b.method &&
    a.url === b.url &&
    a.mode === b.mode &&
    a.selector === b.selector &&
    a.automatic === b.automatic &&
    a.attribute === b.attribute &&
    a.index === b.index &&
    a.mappings?.url === b.mappings?.url &&
    a.mappings?.pageURL === b.mappings?.pageURL
  );
}

export function sciHubCustomResolver(url: string, automatic = true): CustomResolver {
  return {
    name: "Sci-Hub",
    method: "GET",
    url: url.includes("{doi}")
      ? url
      : url.endsWith("/")
        ? `${url}{doi}`
        : `${url}/{doi}`,
    mode: "html",
    selector: "#pdf",
    attribute: "src",
    automatic,
  };
}

export const PRESET_SCIHUB_URLS = [
  "https://sci-hub.se/",
  "https://sci-hub.st/",
  "https://sci-hub.ru/",
  "https://sci-hub.box/",
  "https://sci-hub.red/",
  "https://sci-hub.ren/",
  "https://sci-hub.ee/",
] as const;

export function parseSciHubUrls(value: string) {
  const urls = value
    .split(/\s*[;,，；、\s]\s*/)
    .map((url) => url.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

export function buildSciHubCustomResolvers(
  urls: string[],
  automatic = true,
): Readonly<Readonly<CustomResolver>[]> {
  return urls.map((url) => sciHubCustomResolver(url, automatic));
}

export function presetSciHubCustomResolvers(
  automatic = true,
): Readonly<Readonly<CustomResolver>[]> {
  return buildSciHubCustomResolvers([...PRESET_SCIHUB_URLS], automatic);
}

export function defaultSciHubUrlsString() {
  return PRESET_SCIHUB_URLS.join(",");
}
