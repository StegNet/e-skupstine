// Quorum and majority rules. The law leaves both to each udruga's statut, so they are per-assembly / per-question settings.

/** Quorum: strictly more than `percent`% of members with voting right must be present ("više od polovine" = 50). */
export function quorumMet(present: number, eligible: number, percent: number) {
  return present * 100 > eligible * percent;
}

export type MajorityRule = {
  kind: "motion" | "election";
  majorityBase: "votes_cast" | "present" | "members";
  majorityFraction: "half" | "two_thirds";
  presentAtOpen: number | null;
  eligibleAtOpen: number | null;
};

/** For motions, option 0 is "Za". Elections have no single outcome, so null. */
export function isAdopted(q: MajorityRule, counts: number[], valid: number): boolean | null {
  if (q.kind !== "motion") return null;
  const base =
    q.majorityBase === "votes_cast" ? valid : q.majorityBase === "present" ? (q.presentAtOpen ?? 0) : (q.eligibleAtOpen ?? 0);
  const za = counts[0] ?? 0;
  // "više od polovine" is strict; "dvotrećinska većina" is at least two thirds.
  return q.majorityFraction === "half" ? za * 2 > base : za * 3 >= base * 2;
}
