/**
 * Machine-code numbering.
 *
 * `batchCreateKiosks` mints codes as `ADLX-<year>-A<nnn>` from a per-year counter in
 * `MachineSequence`. The device sync registers hardware under its own device id, and when
 * that id already follows the same pattern it occupies a slot the generator would later
 * hand out -- so minting collides on `Kiosk.machineCode` (a unique column) and the whole
 * batch fails with 409.
 *
 * These helpers let the sync push the counter past any code it registers, so the two
 * writers share one numbering space instead of racing over it.
 */

/** Parsed `ADLX-<year>-<letter><digits>`, or null when the code follows another scheme. */
export function parseAdlxMachineCode(machineCode: string, year: number) {
  const match = new RegExp(`^ADLX-${year}-([A-Z])(\\d{3})$`).exec(machineCode);
  if (!match) return null;
  return { letter: match[1]!, number: Number(match[2]) };
}

/**
 * The counter value a code occupies: 0 when the code is outside this year's scheme.
 * `formatMachineCode` maps 1 -> A001 within a single letter, so the counter is the
 * numeric part directly.
 */
export function machineCodeCounterFloor(machineCode: string, year: number) {
  const parsed = parseAdlxMachineCode(machineCode, year);
  if (!parsed || parsed.letter !== "A") return 0;
  return parsed.number;
}
