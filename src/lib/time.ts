// Assemblies are Croatian, so datetime-local inputs are read and shown in Europe/Zagreb regardless of server TZ.
const TZ = "Europe/Zagreb";

/** "2026-11-20T18:00" as Zagreb wall-clock time → Date */
export function fromZagrebLocal(v: string) {
  const asUtc = new Date(`${v}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const wall = new Date(`${asUtc.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T")}Z`);
  return new Date(asUtc.getTime() - (wall.getTime() - asUtc.getTime()));
}

/** Date → "2026-11-20T18:00" in Zagreb, for datetime-local inputs */
export const toZagrebLocal = (d: Date | null) =>
  d ? d.toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 16).replace(" ", "T") : "";
