import { ProfileCard } from './ProfileCard';
import type { Me } from '../../core/types';
import type { CosmeticKind } from '../../../../shared/economy';

/** A small live preview of your own card wearing one item (frame, theme, name effect or accessory). */
export function FramePreview({ me, kind, id, large }: { me: Me; kind: CosmeticKind; id: string; large?: boolean }) {
  const p = { ...me, banner: null, presence: null, frame: null, effect: null, nameFx: null, accessory: null, [kind]: id };
  return (
    <div className={`frame-preview ${large ? 'large' : ''}`} data-kind={kind}>
      <ProfileCard compact p={p} />
    </div>
  );
}
