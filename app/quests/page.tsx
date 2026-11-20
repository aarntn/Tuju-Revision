import type { Metadata } from "next";
import { Quests } from "@/components/Quests";
import { getRoute } from "@/lib/data";
import { prefsQuery } from "@/lib/onboarding";
import { onRoute, placeQuests, QUESTS, surauQuests } from "@/lib/quests";

export const metadata: Metadata = { title: "Side quests · LaPan" };

export default async function QuestsPage({ searchParams }: { searchParams: Promise<{ lang?: string; id?: string; from?: string }> }) {
  const query = await searchParams;
  const lang = query.lang === "bm" ? "bm" : "en";
  // Quests are placed on the verified KL → Ipoh corridor, the route the app ships with.
  const { line, rnr } = getRoute();
  const quests = onRoute(placeQuests(line, [...QUESTS, ...surauQuests(rnr.items)]));
  const back = (query.from === "plan" ? "/plan" : "/") + prefsQuery({ lang }, query.from === "plan" ? {} : { home: "1" });
  return <Quests lang={lang} quests={quests} back={back} plan={"/plan" + prefsQuery({ lang })} initialId={query.id} />;
}
