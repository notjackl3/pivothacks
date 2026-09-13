import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginView } from "@/components/LoginView";
import { FullPageSpinner } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <LoginView />
    </Suspense>
  );
}
