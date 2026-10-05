// OWNER: Agent 3
// Small, bounded pixel-particle burst for a correct guess. Purely decorative; hidden for
// prefers-reduced-motion and never blocks input (pointer-events: none).
import type { CSSProperties } from 'react';
import styles from './SkribbleGame.module.scss';

const PARTICLES = 12;

export function CorrectBurst() {
  return (
    <div className={styles.burst} aria-hidden="true">
      {Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2;
        const distance = 70 + (i % 3) * 25;
        const style = {
          '--dx': `${Math.cos(angle) * distance}px`,
          '--dy': `${Math.sin(angle) * distance}px`,
        } as CSSProperties;
        return <span key={i} className={`${styles.particle} ${i % 2 ? styles.particleAlt : ''}`} style={style} />;
      })}
      <span className={styles.burstLabel}>Correct!</span>
    </div>
  );
}
