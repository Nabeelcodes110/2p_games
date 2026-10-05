import { GAME_IDS, type GameId } from '@2p/shared';
import { GAME_REGISTRY } from '../games/registry';
import { PixelIcon } from '../components/PixelIcon';
import styles from './GameSelectScreen.module.scss';

interface GameSelectScreenProps {
  onSelect: (game: GameId) => void;
}

/** First screen: a drawer of game cards generated from the registry. */
export function GameSelectScreen({ onSelect }: GameSelectScreenProps) {
  return (
    <div className={styles.screen}>
      <header className={styles.hero}>
        <h1 className={styles.logo}>2P Blocks</h1>
        <p className={styles.subtitle}>Two players. One room. Pick a game.</p>
      </header>

      <section className={styles.drawer} aria-labelledby="game-drawer-title">
        <h2 id="game-drawer-title" className={styles.drawerTitle}>
          Choose a game
        </h2>
        <ul className={styles.cards}>
          {GAME_IDS.map((id) => {
            const { info } = GAME_REGISTRY[id];
            return (
              <li key={id}>
                <button type="button" className={styles.card} onClick={() => onSelect(id)}>
                  <span className={styles.cardIcon}>
                    <PixelIcon name={GAME_REGISTRY[id].icon} size={36} />
                  </span>
                  <span>
                    <span className={styles.cardName}>{info.name}</span>
                    <span className={styles.cardTagline}>{info.tagline}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className={styles.more}>More games are coming to the crafting table.</p>
      </section>
    </div>
  );
}
