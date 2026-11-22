export interface Chunk {
  file: string;
  src?: string;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}
export declare const KB: number;
export declare const BAND_BYTES: number;
export declare const STORY_BYTES: number;
export declare function lazyBudget(input: { manifest: Record<string, Chunk>; entry: string; gz: (file: string) => number; preloaded: string[] }): {
  failures: string[];
  bands: Record<string, number>;
  story: number;
  lazy: Record<string, number>;
};
export declare const PRESENT_ROUTE_BYTES: number;
export declare const PRESENT_ROUTE_ALL_BYTES: number;
export declare const PAINTED_BYTES: number;
export declare const PRESENT_PREFETCH_BYTES: number;
export declare function presentBudget(input: { manifest: Record<string, Chunk>; entry: string; gz: (file: string) => number; art: RegExp }): {
  failures: string[];
  own: number;
  route: number;
  painted: number;
  art: number;
  prefetch: number;
};
