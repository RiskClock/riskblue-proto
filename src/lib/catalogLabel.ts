/**
 * "Catalog" vs "Catalogue" depending on the viewer's locale.
 * UK, Canada, Ireland, Australia, New Zealand and South Africa use "Catalogue".
 */
const BRITISH_REGIONS = ["GB", "UK", "CA", "IE", "AU", "NZ", "ZA"];

export function catalogWord(): "Catalog" | "Catalogue" {
  if (typeof navigator === "undefined") return "Catalog";
  const locales = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  const british = locales.some((l) => {
    const region = l.split("-")[1]?.toUpperCase();
    return region ? BRITISH_REGIONS.includes(region) : false;
  });
  return british ? "Catalogue" : "Catalog";
}

export function productCatalogLabel(): string {
  return `Product ${catalogWord()}`;
}
