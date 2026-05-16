import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { mergeSheet } from '../data/defaultSheet.js';
import { Card, Header, Label } from '../components/SharedUI.jsx';

function Track({ values, kind }) {
  const G = useTheme();
  // Health / paradox: numeric severity per box (0=empty, 1+=filled).
  // Arete / quint: booleans.
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {values.map((v, i) => {
        const filled = kind === 'bool' ? !!v : v > 0;
        return (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: 2,
            border: `1px solid ${G.gold}66`,
            background: filled ? G.gold : 'transparent',
          }} />
        );
      })}
    </div>
  );
}

function Dots({ value, max = 5 }) {
  const G = useTheme();
  return (
    <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} style={{
          width: 9, height: 9, borderRadius: '50%',
          border: `1px solid ${G.gold}88`,
          background: i < value ? G.gold : 'transparent',
        }} />
      ))}
    </span>
  );
}

function StatRow({ name, value }) {
  const G = useTheme();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{name}</span>
      <Dots value={value || 0} />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Card>
      <Label>{title}</Label>
      {children}
    </Card>
  );
}

export default function CharacterSheetView({ character, onBack }) {
  const G = useTheme();
  const sheet = useMemo(() => mergeSheet(character.sheet), [character.sheet]);

  const id = sheet.identity || {};

  return (
    <div style={{ minHeight: '100dvh', background: G.bg, paddingBottom: 40 }}>
      <Header
        title={id.name || character.name || 'Unnamed Mage'}
        subtitle={[id.tradition, id.concept].filter(Boolean).join(' · ') || '—'}
        onBack={onBack}
      />

      <div style={{ padding: '14px 16px 0' }}>
        <Section title="Identity">
          {['chronicle','ambition','desire','avatar','paradigm','tutor'].map((k) => (
            id[k] ? (
              <div key={k} style={{ marginBottom: 6 }}>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em', color: G.muted, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{id[k]}</div>
              </div>
            ) : null
          ))}
        </Section>

        <Section title="Attributes">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            {[['Physical', sheet.physical], ['Social', sheet.social], ['Mental', sheet.mental]].map(([grp, obj]) => (
              <div key={grp}>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 4 }}>{grp.toUpperCase()}</div>
                {Object.entries(obj).map(([k, v]) => <StatRow key={k} name={k} value={v} />)}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Spheres">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {sheet.spheres.filter((s) => s.name || s.value).map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{s.name || '—'}</span>
                <Dots value={s.value || 0} max={5} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Tracks">
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 3 }}>HEALTH</div>
            <Track values={sheet.health} kind="num" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 3 }}>WILLPOWER</div>
            <Track values={sheet.willpower} kind="num" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 3 }}>
              ARETE&nbsp;({sheet.arete.filter(Boolean).length})
            </div>
            <Track values={sheet.arete} kind="bool" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 3 }}>
              QUINTESSENCE&nbsp;({sheet.quint.filter(Boolean).length})
            </div>
            <Track values={sheet.quint} kind="bool" />
          </div>
          <div>
            <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 3 }}>
              PARADOX&nbsp;({sheet.paradox.filter((v) => v > 0).length})
            </div>
            <Track values={sheet.paradox} kind="num" />
          </div>
        </Section>

        <Section title="Skills">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            {[['Physical', sheet.physSkills], ['Social', sheet.socSkills], ['Mental', sheet.mentSkills]].map(([grp, list]) => (
              <div key={grp}>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em', color: G.goldDim, marginBottom: 4 }}>{grp.toUpperCase()}</div>
                {list.filter((s) => s.value > 0).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                    <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 12, color: G.text }}>
                      {s.label}{s.spec ? <em style={{ color: G.muted }}> ({s.spec})</em> : null}
                    </span>
                    <Dots value={s.value} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        {(sheet.backgrounds || []).some((b) => b.name) && (
          <Section title="Backgrounds">
            {sheet.backgrounds.filter((b) => b.name).map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{b.name}</span>
                <Dots value={b.value} />
              </div>
            ))}
          </Section>
        )}

        {(sheet.merits || []).some((b) => b.name) && (
          <Section title="Merits">
            {sheet.merits.filter((b) => b.name).map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{b.name}</span>
                <Dots value={b.value} />
              </div>
            ))}
          </Section>
        )}

        {(sheet.flaws || []).some((b) => b.name) && (
          <Section title="Flaws">
            {sheet.flaws.filter((b) => b.name).map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{b.name}</span>
                <Dots value={b.value} />
              </div>
            ))}
          </Section>
        )}

        {(sheet.weapons || []).some((w) => w.name) && (
          <Section title="Weapons">
            {sheet.weapons.filter((w) => w.name).map((w, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text }}>{w.name}</span>
                <span style={{ fontFamily: 'Cinzel,serif', fontSize: 11, color: G.goldDim }}>{w.dmg}</span>
              </div>
            ))}
          </Section>
        )}

        {(sheet.notes || sheet.history || sheet.appearance) && (
          <Section title="Narrative">
            {['appearance','distFeatures','history','possessions','notes','awakening'].map((k) => (
              sheet[k] ? (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.15em', color: G.muted, textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 13, color: G.text, whiteSpace: 'pre-wrap' }}>{sheet[k]}</div>
                </div>
              ) : null
            ))}
          </Section>
        )}

        {(sheet.xpTotal || sheet.xpSpent) && (
          <Section title="Experience">
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, color: G.muted, letterSpacing: '.15em' }}>TOTAL</div>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 16, color: G.gold }}>{sheet.xpTotal || '—'}</div>
              </div>
              <div>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 9, color: G.muted, letterSpacing: '.15em' }}>SPENT</div>
                <div style={{ fontFamily: 'Cinzel,serif', fontSize: 16, color: G.gold }}>{sheet.xpSpent || '—'}</div>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
