import type { HTMLAttributes } from 'react';
import styles from './Panel.module.scss';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'parchment' | 'wood' | 'stone';
}

export function Panel({ tone = 'parchment', className, ...rest }: PanelProps) {
  const classes = [styles.panel, tone !== 'parchment' ? styles[tone] : '', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
