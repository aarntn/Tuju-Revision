import type { Metadata } from "next";
import { Garage } from "@/components/Garage";
import { prefsQuery } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Garage · LaPan" };

export default async function GaragePage({ searchParams }: { searchParams: Promise<{ lang?: string; from?: string }> }) {
  const query = await searchParams;
  const lang = query.lang === "bm" ? "bm" : "en";
  const back = (query.from === "plan" ? "/plan" : "/") + prefsQuery({ lang }, query.from === "plan" ? {} : { home: "1" });
  return <Garage lang={lang} back={back} />;
}
