import { redirect } from "next/navigation";

/** Reports and analytics share the governed metric registry and report builder. */
export default function ReportsPage() {
  redirect("/analytics");
}
