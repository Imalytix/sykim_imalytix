import type { BBox } from "@/types/analysis";

export function isValidBBox(bbox?: BBox | null): bbox is BBox {
  if (!bbox) return false;
  return bbox.x1 >= 0 && bbox.y1 >= 0 && bbox.x2 <= 1 && bbox.y2 <= 1 && bbox.x2 > bbox.x1 && bbox.y2 > bbox.y1;
}
