// The smile zone (present-studio-design §6.5): the teeth people notice when someone smiles. The rule lives
// here as data so a style never decides it: FDI 13-23 and 33-43 (milk 53-63, 73-83), plus the premolars
// (14, 15, 24, 25, 34, 35, 44, 45) when the lips are drawn wide.
export const SMILE_ZONE = {
  core: [13, 12, 11, 21, 22, 23, 33, 32, 31, 41, 42, 43, 53, 52, 51, 61, 62, 63, 73, 72, 71, 81, 82, 83],
  wide: [14, 15, 24, 25, 34, 35, 44, 45],
} as const;

export const inSmileZone = (tooth: number, wide = false): boolean =>
  SMILE_ZONE.core.some((t) => t === tooth) || (wide && SMILE_ZONE.wide.some((t) => t === tooth));
