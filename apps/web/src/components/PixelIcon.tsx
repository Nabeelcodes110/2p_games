// Small original pixel icons drawn as SVG rects on a 16x16 grid. Decorative: aria-hidden.
export type IconName = 'pencil' | 'palette' | 'crown' | 'player' | 'copy' | 'check' | 'back';

interface Grid {
  rows: string[];
  colors: Record<string, string>;
}

const GRIDS: Record<IconName, Grid> = {
  pencil: {
    colors: { a: '#f2c94c', b: '#b8901d', c: '#f5e8c8', d: '#252525' },
    rows: [
      '..............dd',
      '.............dad',
      '............dabd',
      '...........dabd.',
      '..........dabd..',
      '.........dabd...',
      '........dabd....',
      '.......dabd.....',
      '......dabd......',
      '.....dabd.......',
      '....dabd........',
      '...dccbd........',
      '..dcccd.........',
      '.dccdd..........',
      '.ddd............',
      '................',
    ],
  },
  palette: {
    colors: { w: '#c9955a', k: '#8a5a2b', d: '#252525', r: '#d32f2f', g: '#5d8c3e', b: '#1565c0', y: '#f2c94c' },
    rows: [
      '................',
      '.....dddddd.....',
      '...ddwwwwwwdd...',
      '..dwwwwwwwwwwd..',
      '.dwwrrwwwwyywwd.',
      '.dwwrrwwwwyywwd.',
      '.dwwwwwwwwwwwwd.',
      '.dwwggwwwwwwwwd.',
      '.dwwggwwwddwwwd.',
      '.dwwwwwwdkkdwwd.',
      '..dwbbwwwddwwd..',
      '..dwbbwwwwwwd...',
      '...ddwwwwwwdd...',
      '.....dddddd.....',
      '................',
      '................',
    ],
  },
  crown: {
    colors: { a: '#f2c94c', b: '#b8901d', d: '#252525', r: '#d32f2f' },
    rows: [
      '................',
      '................',
      '..d....d....d...',
      '.dad..dad..dad..',
      '.dada.dad.dada..',
      '.daadadaadadaad.',
      '.daaaaaaaaaaaad.',
      '.daaaaaraaaaaad.',
      '.dabaaaaaaabad..',
      '.dbbbbbbbbbbbd..',
      '.dddddddddddddd.',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  player: {
    colors: { s: '#c68a5e', h: '#4a2f1b', e: '#ffffff', p: '#3b4fa8', m: '#7a4a2a', t: '#2fa7a0', l: '#3b4fa8' },
    rows: [
      '................',
      '....hhhhhhhh....',
      '....hhhhhhhh....',
      '....hsssssshh...',
      '....ssssssss....',
      '....epssssep....',
      '....ssssssss....',
      '....ssmmmmss....',
      '....ssssssss....',
      '...tttttttttt...',
      '...tttttttttt...',
      '...ssttttttss...',
      '...ssttttttss...',
      '....llllllll....',
      '....ll....ll....',
      '....ll....ll....',
    ],
  },
  copy: {
    colors: { a: '#f5e8c8', d: '#252525' },
    rows: [
      '................',
      '..dddddd........',
      '..daaaad........',
      '..da.dddddd.....',
      '..da.daaaad.....',
      '..da.da..ad.....',
      '..dddda..ad.....',
      '.....da..ad.....',
      '.....daaaad.....',
      '.....dddddd.....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  check: {
    colors: { a: '#9bd36b', d: '#252525' },
    rows: [
      '................',
      '................',
      '..............d.',
      '.............dad',
      '............dad.',
      '...d.......dad..',
      '..dad.....dad...',
      '...dad...dad....',
      '....dad.dad.....',
      '.....dadad......',
      '......dad.......',
      '.......d........',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  back: {
    colors: { a: '#f5e8c8', d: '#252525' },
    rows: [
      '................',
      '................',
      '.....d..........',
      '....dad.........',
      '...dad..........',
      '..dadddddddd....',
      '..daaaaaaaad....',
      '..dadddddddd....',
      '...dad..........',
      '....dad.........',
      '.....d..........',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
};

export function PixelIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  const { rows, colors } = GRIDS[name];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      style={{ flex: 'none' }}
    >
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          colors[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={colors[ch]} /> : null,
        ),
      )}
    </svg>
  );
}
