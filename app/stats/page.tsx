import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatsTable } from "@/components/StatsTable";

export const metadata: Metadata = { title: "Tester stats · LaPan", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function Stats({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!process.env.STATS_KEY || key !== process.env.STATS_KEY) notFound();
  return <main className="page stack" data-testid="screen-stats">
    <h1>Tester stats</h1>
    <StatsTable />
    <a className="btn" href="/plan">Back to Plan</a>
  </main>;
}
