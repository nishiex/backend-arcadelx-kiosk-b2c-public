/**
 * PIN code -> location lookup for the organization registration forms.
 *
 * Source: the public India Post dataset served by api.postalpincode.in. A PIN
 * maps to several post offices; the forms only need a state the state select can
 * match and a city to prefill, so the first delivery-capable office is reduced to
 * { state, district } and the district is used as the city.
 *
 * The lookup is best-effort by design: an unknown PIN, no connectivity or an
 * upstream error all return null, and the form keeps accepting a manually chosen
 * state and city. Only successful results are cached (for a day): a PIN's
 * district does not move, but a failure may be transient.
 */
export type PincodeLocation = {
  pincode: string;
  state: string;
  district: string;
  city: string;
};

type PostOffice = {
  State?: string | null;
  District?: string | null;
};

type PostOfficeResponse = {
  Status?: string;
  PostOffice?: PostOffice[] | null;
};

const LOOKUP_URL = "https://api.postalpincode.in/pincode";
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_LIMIT = 5_000;

const cache = new Map<string, { expiresAt: number; location: PincodeLocation }>();

function remember(pincode: string, location: PincodeLocation) {
  if (cache.size >= CACHE_LIMIT) {
    // Map preserves insertion order, so the first key is the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(pincode, { expiresAt: Date.now() + CACHE_TTL_MS, location });
}

/** True for the six-digit Indian PIN codes the registration forms accept. */
export function isPincodeFormat(pincode: string) {
  return /^\d{6}$/.test(pincode);
}

export async function lookupPincode(pincode: string): Promise<PincodeLocation | null> {
  const cached = cache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) return cached.location;

  try {
    const response = await fetch(`${LOOKUP_URL}/${pincode}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as PostOfficeResponse[] | null;
    const offices = payload?.[0]?.PostOffice ?? [];
    // A PIN covers several post offices. The most frequent district is the town
    // the PIN actually belongs to; the first delivery office can be an outlier
    // (400001 lists six Mumbai offices and one Raigarh one), which would prefill
    // the wrong city.
    const districtCounts = new Map<string, number>();
    for (const entry of offices) {
      if (!entry.District) continue;
      districtCounts.set(entry.District, (districtCounts.get(entry.District) ?? 0) + 1);
    }
    const district = [...districtCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!district) return null;
    const office =
      offices.find((entry) => entry.District === district && entry.State) ??
      offices.find((entry) => entry.State);
    if (!office?.State) return null;

    const location: PincodeLocation = {
      pincode,
      state: office.State.trim(),
      district: district.trim(),
      city: district.trim(),
    };
    remember(pincode, location);
    return location;
  } catch (error) {
    // A timeout or DNS failure is not the caller's problem: the form falls back
    // to manual entry, so this is logged rather than surfaced as a 500.
    console.error(
      "[pincode] lookup failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
