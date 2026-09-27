"use client";

import { useParams } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { PublicDateView } from "@/components/date-share/public-date-view";

// FR-388/392: the public route (docs/requirements.md Feature 19) —
// deliberately outside app/(tabs), with its own minimal layout and no
// dependency on any auth state. Reachable with zero cookies (FR-394/395).
export default function PublicDateSharePage() {
  const params = useParams<{ token: string }>();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <BrandMark />
      <PublicDateView token={params.token} />
    </div>
  );
}
