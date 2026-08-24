import type { VerificationStatus } from "@/api-client";
import { MediaAssetComposer } from "./image-composer";

export function MediaComposer(props: {
  canSchedule: boolean;
  initialDistributionMode: "post" | "moment";
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  return <MediaAssetComposer {...props} />;
}
