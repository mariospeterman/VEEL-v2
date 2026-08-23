import type { VerificationStatus } from "@/api-client";
import { MediaAssetComposer } from "./image-composer";

export function MediaComposer(props: {
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  return <MediaAssetComposer {...props} />;
}
