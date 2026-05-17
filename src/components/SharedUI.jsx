import { useTheme } from '../context/ThemeContext.jsx';

export function Toast({ msg }) {
  const G = useTheme();
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 80, transform: 'translateX(-50%)',
      background: G.surface, border: `1px solid ${G.gold}`, color: G.gold,
      fontFamily: 'Cinzel,serif', fontSize: 12, letterSpacing: '.08em',
      padding: '10px 18px', borderRadius: 3, zIndex: 200, maxWidth: '90vw',
    }}>{msg}</div>
  );
}

export function Header({ title, subtitle, right, onBack }) {
  const G = useTheme();
  return (
    <div style={{
      padding: '20px 16px 14px', borderBottom: `1px solid ${G.goldFaint}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          fontFamily: 'Cinzel,serif', fontSize: 11, letterSpacing: '.15em',
          border: `1px solid ${G.gold}55`, borderRadius: 3,
          background: 'transparent', color: G.goldDim, padding: '6px 10px', cursor: 'pointer',
        }}>← BACK</button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'Cinzel Decorative,serif', fontSize: 18, color: G.gold,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontFamily: 'EB Garamond,serif', fontStyle: 'italic',
            fontSize: 12, color: G.muted, marginTop: 2,
          }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, style }) {
  const G = useTheme();
  return (
    <div style={{
      background: G.card, border: `1px solid ${G.border}`,
      borderRadius: 3, padding: '12px 14px', marginBottom: 12,
      ...style,
    }}>{children}</div>
  );
}

export function Label({ children, style }) {
  const G = useTheme();
  return (
    <div style={{
      fontFamily: 'Cinzel,serif', fontSize: 9, letterSpacing: '.22em',
      color: G.goldDim, textTransform: 'uppercase', marginBottom: 4,
      ...style,
    }}>{children}</div>
  );
}

export function GoldButton({ children, onClick, disabled, style }) {
  const G = useTheme();
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: 'Cinzel,serif', fontSize: 12, letterSpacing: '.18em',
      border: `1px solid ${disabled ? G.goldFaint : G.gold}`, borderRadius: 3,
      background: 'transparent', color: disabled ? G.muted : G.gold,
      padding: '10px 18px', cursor: disabled ? 'default' : 'pointer',
      ...style,
    }}>{children}</button>
  );
}

export function ConfirmModal({ message, onConfirm, onCancel }) {
  const G = useTheme();
  if (!message) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300, padding: 24,
    }}>
      <div style={{
        background: G.card, border: `1px solid ${G.gold}55`,
        borderRadius: 4, padding: '24px 20px', maxWidth: 320, width: '100%',
      }}>
        <div style={{ fontFamily: 'EB Garamond,serif', color: G.text, fontSize: 15, marginBottom: 20 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em',
            border: `1px solid ${G.border}`, borderRadius: 3,
            background: 'transparent', color: G.muted, padding: '8px 14px', cursor: 'pointer',
          }}>CANCEL</button>
          <button onClick={onConfirm} style={{
            fontFamily: 'Cinzel,serif', fontSize: 10, letterSpacing: '.15em',
            border: `1px solid ${G.red}`, borderRadius: 3,
            background: 'transparent', color: G.red, padding: '8px 14px', cursor: 'pointer',
          }}>DELETE</button>
        </div>
      </div>
    </div>
  );
}
