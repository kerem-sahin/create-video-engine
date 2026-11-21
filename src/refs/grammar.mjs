import * as C from './constants.mjs';

const s = (n) => `${n}s`;

export function buildGrammar(a) {
  const L = [];
  L.push('# Reference grammar');
  L.push('');
  L.push(`Source: ${a.source}`);
  L.push('');
  L.push('Every number below is marked "measured": it was computed from the video file by `create-video-engine refs`, not judged by eye. Use the grammar (rhythm, colour, motion), never the content.');
  L.push('');
  L.push('## Format');
  L.push(`- Duration: ${s(a.duration)} (measured)`);
  L.push(`- Frame size: ${a.width}x${a.height} (measured)`);
  L.push(`- Frame rate: ${a.fps} fps (measured)`);
  L.push('');
  L.push('## Cuts and shot length');
  L.push(`- Cuts found: ${a.cuts.length}${a.cuts.length ? ` at ${a.cuts.map(s).join(', ')}` : ''} (measured, scene score above ${a.params.scene_threshold}; gradual dissolves may be missed)`);
  L.push(`- Shots: ${a.shots.length} (measured)`);
  if (a.shot_length.median !== null) {
    L.push(`- Shot length: shortest ${s(a.shot_length.min)}, median ${s(a.shot_length.median)}, longest ${s(a.shot_length.max)} (measured)`);
  }
  L.push(`- Cut rate: ${a.cuts_per_10s} cuts per 10 seconds (measured)`);
  if (!a.cuts.length) L.push('- No hard cuts were detected: the video is one continuous shot or uses only gradual transitions (measured).');
  L.push('');
  L.push('## Colour');
  L.push(`Dominant colours, from frames sampled once per second and grouped on a coarse grid (${C.PALETTE_LEVELS} levels per channel), so each value is a bucket centre, not an exact brand colour (measured):`);
  for (const p of a.palette) L.push(`- ${p.hex}: ${Math.round(p.share * 1000) / 10}% of sampled pixels (measured)`);
  L.push('');
  L.push('## Motion');
  const me = a.motion_energy;
  if (me.length) {
    const avg = me.reduce((x, y) => x + y, 0) / me.length;
    const max = Math.max(...me);
    const min = Math.min(...me);
    L.push(`- Average motion energy: ${Math.round(avg * 100) / 100} (mean absolute luma change between frames, 0-255 scale) (measured)`);
    L.push(`- Busiest second: ${me.indexOf(max)}s-${me.indexOf(max) + 1}s at ${max} (measured)`);
    L.push(`- Calmest second: ${me.indexOf(min)}s-${me.indexOf(min) + 1}s at ${min} (measured)`);
    L.push('- Per-second values are in `analysis.json` under `motion_energy`.');
  }
  L.push('');
  L.push('## Not measured (needs a human eye)');
  L.push('- Typography: typeface, weight, size, how text enters and leaves.');
  L.push('- Transition style: whether cuts are matched, whip, zoom or dissolve; only the timing of hard cuts is measured above.');
  L.push('- Music: tempo, genre, how cuts sit on the beat, and loudness.');
  L.push('- Layout, subject matter and tone of voice.');
  L.push('');
  L.push('Check `contact-sheet.png` and `frames/` before turning any of this into a rule. Mark anything taken from here as measured, and anything you add by eye as guessed.');
  L.push('');
  return L.join('\n');
}
