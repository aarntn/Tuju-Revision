import { redirect } from "next/navigation";

/** Onboarding was removed: the app opens straight on the planner. Old links (with their language and needs) still work. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const text = query.toString();
  redirect("/plan" + (text ? `?${text}` : ""));
}
