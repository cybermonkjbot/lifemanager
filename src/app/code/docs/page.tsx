import { CodeLabDocs } from "@/components/code-lab-docs";
import { DashboardPage } from "@/components/dashboard-page";

export default async function CodeDocsPage() {
  return (
    <DashboardPage
      title="ODOGWU Programming Language Docs"
      subtitle="Language, SDK, and HQ behavior reference."
      hideShellChrome
      hideViewHeader
    >
      <CodeLabDocs />
    </DashboardPage>
  );
}
