import assets from "@/content/assets.json";

export type AssetManifestEntry = {
  path: string;
  logicalWidth: number;
  logicalHeight: number;
  density: number;
  maxBytes: number;
  usedBy: string;
};

export const assetManifest = assets as AssetManifestEntry[];
