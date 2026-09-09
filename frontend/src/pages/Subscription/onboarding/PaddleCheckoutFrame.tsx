import { useLayoutEffect } from 'react';
import { useLanguage } from '@/i18n/context';
import { FlowWaitTick } from '@/pages/Onboarding/FlowShell';

export type PaddleCheckoutFrameProps = {
  /** Set only after the controller receives checkout.loaded. */
  ready: boolean;
  /** Pass the stable callback from useCheckoutSession. */
  registerFrameTarget: (className: string | null) => void;
  /** What the page is waiting for before the form can appear. */
  label?: string;
};

const FRAME_TARGET = 'paddle-checkout-frame';

function GhostField() {
  return <div><span className="flow-card-ghost-label" /><div className="flow-skeleton" /></div>;
}

/** Owns the target element only. Paddle owns every child it inserts. */
export default function PaddleCheckoutFrame({ ready, registerFrameTarget, label }: PaddleCheckoutFrameProps) {
  const { t } = useLanguage();

  useLayoutEffect(() => {
    registerFrameTarget(FRAME_TARGET);
    return () => registerFrameTarget(null);
  }, [registerFrameTarget]);

  return (
    <div dir="ltr" aria-busy={!ready} className="relative min-h-[450px] min-w-[312px] w-full overflow-visible">
      {!ready && (
        <div className="flow-card-wait absolute inset-x-0 top-0">
          <div className="flow-wait">
            <FlowWaitTick />
            <p role="status" dir="auto">{label ?? t('Loading the secure card form')}</p>
          </div>
          <div className="flow-card-ghost" aria-hidden="true">
            <GhostField />
            <GhostField />
            <GhostField />
            <div className="flow-card-ghost-row">
              <GhostField />
              <GhostField />
            </div>
            <div className="flow-card-ghost-button flow-skeleton" />
          </div>
        </div>
      )}
      <div aria-hidden={!ready} inert={!ready} className={ready ? 'flow-frame-ready' : 'invisible opacity-0'}>
        <div className={FRAME_TARGET} style={{ minHeight: 450, minWidth: 312, width: '100%', overflow: 'visible' }} />
      </div>
    </div>
  );
}
