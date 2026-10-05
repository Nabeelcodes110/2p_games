import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicConfig } from '@2p/shared';

export interface MusicControls {
  available: boolean;
  playing: boolean;
  muted: boolean;
  volume: number;
  /** Must be called from a user gesture; browsers block autoplay otherwise. */
  toggle: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  error: string | null;
}

/** Optional background music via a plain HTMLAudioElement. Nothing plays until the user presses play. */
export function useMusic(config: MusicConfig | undefined): MusicControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(config?.volume ?? 0.5);
  const [error, setError] = useState<string | null>(null);
  const src = config?.src;
  const loop = config?.loop ?? true;

  useEffect(() => {
    if (!src) return;
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = src;
    audio.loop = loop;
    audioRef.current = audio;
    const onEnded = () => setPlaying(false);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
      setPlaying(false);
    };
  }, [src, loop]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted, src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setError(null);
    audio.volume = volume;
    audio.muted = muted;
    audio.play().then(
      () => setPlaying(true),
      () => setError('Music could not be played.'),
    );
  }, [volume, muted]);

  return {
    available: Boolean(src),
    playing,
    muted,
    volume,
    toggle,
    toggleMute: () => setMuted((m) => !m),
    setVolume: (v) => setVolumeState(Math.min(1, Math.max(0, v))),
    error,
  };
}
