import { useState } from 'react';
import { call } from '../api';
import { useAction } from './ui';
import { BADGES, CATALOG, CATEGORIES, HOUSES, badgeSvg } from '../../../../shared/badges';
import type { Me } from '../../core/types';

export function BadgeIcon({ id, size = 20 }: { id: string; size?: number }) {
  const b = BADGES[id];
  if (!b) return null;
  return <span className="badge-icon" style={{ ['--b-tone' as any]: b.tone, width: size + 10, height: size + 10 }} dangerouslySetInnerHTML={{ __html: badgeSvg(id, size) }} />;
}

const HOUSE_COPY: Record<string, string> = { ember: 'Ember', tide: 'Tide', gale: 'Gale' };

export function BadgesSection({ me }: { me: Me }) {
  const { busy, run } = useAction();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const hidden = new Set(me.hiddenBadges);
  const earned = me.earnedBadges;
  const equippedCount = earned.filter((b) => !hidden.has(b)).length;

  const toggle = (id: string) => {
    const next = hidden.has(id) ? me.hiddenBadges.filter((x) => x !== id) : [...me.hiddenBadges, id];
    run(() => call('updateProfile', { hiddenBadges: next }));
  };
  const setAll = (equip: boolean) => run(() => call('updateProfile', { hiddenBadges: equip ? [] : earned }), equip ? 'All badges equipped' : 'All badges unequipped');

  return (
    <section className="card-section">
      <div className="section-head">
        <h3>Badges</h3>
        <span className="muted small">{equippedCount} of {earned.length} equipped</span>
      </div>
      <p className="muted">Badges are earned, never bought or typed in. Choose which ones show on your profile.</p>
      {earned.length === 0 ? <p className="fine">No badges yet. Open the catalog below to see how to earn them.</p> : (
        <>
          <ul className="badge-list">
            {earned.map((id) => {
              const b = BADGES[id];
              const on = !hidden.has(id);
              return (
                <li key={id} className={on ? 'on' : ''}>
                  <BadgeIcon id={id} />
                  <span className="badge-text">
                    <b>{b.label}{id === 'legacy_username' && me.legacyUsername ? ` @${me.legacyUsername}` : ''}</b>
                    <small>{b.description}</small>
                  </span>
                  <button type="button" role="switch" aria-checked={on} aria-label={`${on ? 'Unequip' : 'Equip'} ${b.label}`} className="switch" disabled={busy} onClick={() => toggle(id)}><i /></button>
                </li>
              );
            })}
          </ul>
          <div className="row">
            <button className="btn ghost sm" disabled={busy} onClick={() => setAll(true)}>Equip all</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setAll(false)}>Unequip all</button>
          </div>
        </>
      )}

      <div className="house-pick">
        <h4>House</h4>
        <p className="fine">Join one of three houses. It adds a badge you can equip, and you can switch any time.</p>
        <div className="house-row" role="radiogroup" aria-label="House">
          {HOUSES.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={me.house === h} className={`house ${me.house === h ? 'on' : ''}`} style={{ ['--b-tone' as any]: BADGES[`house_${h}`].tone }}
              disabled={busy} onClick={() => run(() => call('updateProfile', { house: me.house === h ? null : h }), me.house === h ? 'Left the house' : `Joined House ${HOUSE_COPY[h]}`)}>
              <span dangerouslySetInnerHTML={{ __html: badgeSvg(`house_${h}`, 22) }} />
              {HOUSE_COPY[h]}
            </button>
          ))}
        </div>
      </div>

      <button className="link catalog-toggle" onClick={() => setCatalogOpen(!catalogOpen)} aria-expanded={catalogOpen}>
        {catalogOpen ? 'Hide badge catalog' : `See all ${CATALOG.length} badges`}
      </button>
      {catalogOpen && <BadgeCatalog earned={new Set(earned)} />}
    </section>
  );
}

export function BadgeCatalog({ earned }: { earned: Set<string> }) {
  return (
    <div className="catalog">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="catalog-group">
          <h4>{cat}</h4>
          <ul>
            {CATALOG.filter((b) => b.category === cat).map((b) => (
              <li key={b.id} className={earned.has(b.id) ? 'have' : 'locked'} title={b.description}>
                <BadgeIcon id={b.id} size={18} />
                <span><b>{b.label}</b><small>{earned.has(b.id) ? 'Earned' : b.howTo}</small></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
