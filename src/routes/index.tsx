import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const MutabeeApp = lazy(() => import("@/components/mutabee/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مُتابِع — متابعة المطالبات" },
      { name: "description", content: "مُتابِع: رفع المطالبات من إكسل، توزيعها على الموظفين، ومتابعة السداد والتذكيرات." },
      { property: "og:title", content: "مُتابِع — متابعة المطالبات" },
      { property: "og:description", content: "رفع المطالبات وتوزيعها ومتابعة السداد والتذكيرات لفريق التحصيل." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const loading = <p className="center muted" style={{ padding: 40 }} dir="rtl">جاري التحميل…</p>;
  if (!ready) return loading;
  return (
    <Suspense fallback={loading}>
      <MutabeeApp />
    </Suspense>
  );
}
