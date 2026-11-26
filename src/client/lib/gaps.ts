/** What each gap means for the reader, not just which source is missing. */
export function gapConsequences(keys: string[], nativeSymbol: string): string[] {
  const out: string[] = [];
  if (keys.includes('nativeInternal')) out.push(`${nativeSymbol} moved inside execution is not included, so ${nativeSymbol} balance changes may be incomplete.`);
  if (keys.includes('stateChanges')) out.push('Balance changes could not be checked against the explorer.');
  if (keys.includes('logs') || keys.includes('tokenTransfers')) out.push('Token movements may be incomplete.');
  return out;
}
