import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { invalidateWorkspace } from '@/lib/invalidateWorkspace';
import ProtectedEvidence from '../Verification/ProtectedEvidence';
import { apiMessage, retryStandardPrivacy } from './api';
import { standardPhotoMessage, type StandardPhoto } from './types';
import { canRetryStandardPrivacy, runStandardPrivacyRetry } from './standardPrivacy';

export default function StandardPhotoPreview({areaId,standard}:{areaId:number;standard:StandardPhoto}) {
  const qc = useQueryClient();
  const [busy,setBusy] = useState(false), [failure,setFailure] = useState('');
  const inFlight = useRef(false);
  async function retry() {
    if (inFlight.current || !canRetryStandardPrivacy(standard.privacyState)) return;
    inFlight.current = true; setBusy(true); setFailure('');
    try {
      const result = await runStandardPrivacyRetry(() => retryStandardPrivacy(areaId,standard.id), () => invalidateWorkspace(qc));
      if (!result.ok) setFailure(`Privacy check unavailable. Photo remains pending. ${apiMessage(result.error)}`);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const message = standardPhotoMessage(standard.privacyState);
  const pending = canRetryStandardPrivacy(standard.privacyState);
  return <figure className="space-y-2">
    {message ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p> : <ProtectedEvidence assetId={standard.mediaAssetId} privacyState={standard.privacyState} alt={standard.caption ?? 'Optional cleaning standard'}/>}
    {pending && <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry()}>{busy ? 'Checking privacy…' : 'Retry privacy check'}</Button>}
    {pending && failure && <p role="status" className="text-sm text-muted-foreground">{failure}</p>}
    <figcaption className="text-sm">{standard.caption}</figcaption>
  </figure>;
}
