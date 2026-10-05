import type { ButtonHTMLAttributes } from 'react';
import styles from './PixelButton.module.scss';

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'stone' | 'grass' | 'gold' | 'danger';
  block?: boolean;
}

export function PixelButton({ variant = 'stone', block, className, type = 'button', ...rest }: PixelButtonProps) {
  const classes = [styles.button, variant !== 'stone' ? styles[variant] : '', block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}
