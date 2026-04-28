import { CodeLab } from "@/components/code-lab";
import { DashboardPage } from "@/components/dashboard-page";

export default async function CodePage() {
  return (
    <DashboardPage
      title="Code Lab"
      subtitle="Write, test, and publish local ODOGWU life rules."
      hideShellChrome
      hideViewHeader
    >
      <CodeLab />
    </DashboardPage>
  );
}
