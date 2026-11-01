import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { configuredProviders } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return (
    <Suspense>
      <AuthForm mode="login" providers={configuredProviders()} />
    </Suspense>
  );
}
