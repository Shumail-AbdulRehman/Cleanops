export function canRetryStandardPrivacy(privacyState?: string): boolean {
  return privacyState === 'PENDING';
}

// Refresh even after a lost response: the server may have saved its assessment.
export async function runStandardPrivacyRetry(request: () => Promise<unknown>, refresh: () => Promise<unknown>): Promise<{ok:true} | {ok:false;error:unknown}> {
  try {
    await request();
    return {ok:true};
  } catch (error) {
    return {ok:false,error};
  } finally {
    await refresh();
  }
}
