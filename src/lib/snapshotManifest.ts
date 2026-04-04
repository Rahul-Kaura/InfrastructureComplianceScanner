export const SNAPSHOT_IDS = ["default", "variant"] as const;
export type SnapshotId = (typeof SNAPSHOT_IDS)[number];

export const SNAPSHOT_MANIFEST: Record<
  SnapshotId,
  { label: string; shortLabel: string; buttonTitle: string; file: string; description: string }
> = {
  default: {
    label: "Inventory A — original sample",
    shortLabel: "Inventory A",
    buttonTitle: "Original sample fleet — 5 services",
    file: "sample.json",
    description: "5 services: prod orders/audit, staging analytics, dev DB, dev compute.",
  },
  variant: {
    label: "Inventory B — alternate fleet",
    shortLabel: "Inventory B",
    buttonTitle: "Alternate fleet — 7 services, different IDs",
    file: "sample-variant.json",
    description:
      "7 services: prod catalog/legacy, staging mart + reports + worker, dev lab DB + tools — different IDs; legacy lacks encryption, reports DB triggers cost policy.",
  },
};
