/** Pad a Signify passcode to 21 characters (KERIA agent requirement) */
export function paddedSignifyPasscode(passcode: string): string {
  return passcode.padEnd(21, '_');
}
