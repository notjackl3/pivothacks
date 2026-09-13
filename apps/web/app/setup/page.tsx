import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupView } from "@/components/setup/SetupView";
import { FullPageSpinner } from "@/components/ui";

export const metadata: Metadata = { title: "Setup" };

export default function SetupPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <SetupView />
    </Suspense>
  );
}
