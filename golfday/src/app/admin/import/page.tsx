import { redirect } from "next/navigation";
import { CsvImportConsole } from "@/components/CsvImportConsole";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/import");
  return <CsvImportConsole />;
}
