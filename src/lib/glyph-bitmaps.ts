import { ARAGI_ROWS, INFO_ROWS } from "./aragi-bitmap";

export type GlyphName =
  | "envelope"
  | "check"
  | "github"
  | "linkedin"
  | "aragi"
  | "info";

export interface GlyphSpec {
  cls: string;
  rows: readonly string[];
  wordmark?: {
    text: string;
    anchor: string;
  };
}

const ENVELOPE_ROWS: readonly string[] = [
  "01111111111111110",
  "11111111111111111",
  "11101111111110111",
  "11110111111101111",
  "11111011111011111",
  "11111101110111111",
  "11111110001111111",
  "11111111111111111",
  "11111111111111111",
  "11111111111111111",
  "01111111111111110",
];

const CHECK_ROWS: readonly string[] = [
  "000000000000",
  "000000000110",
  "000000001100",
  "011000011000",
  "001100110000",
  "000111100000",
  "000011000000",
  "000000000000",
];

const GITHUB_ROWS: readonly string[] = [
  "0110000000110",
  "1111100011111",
  "1111111111111",
  "1111111111111",
  "0110011100110",
  "0110011100110",
  "0111111111110",
  "0111111111110",
  "0011111111100",
  "0000111110000",
];

const LINKEDIN_ROWS: readonly string[] = [
  "000111111111000",
  "011111111111110",
  "111111111111111",
  "111111111111111",
  "111001111111111",
  "111111000001111",
  "111001001001111",
  "111001001001111",
  "111001001001111",
  "111001001001111",
  "111001001001111",
  "111111111111111",
  "111111111111111",
  "011111111111110",
  "000111111111000",
];

export const GLYPHS: Record<GlyphName, GlyphSpec> = {
  envelope: { cls: "pixel-envelope", rows: ENVELOPE_ROWS },
  check: { cls: "pixel-check", rows: CHECK_ROWS },
  github: { cls: "pixel-github", rows: GITHUB_ROWS },
  linkedin: { cls: "pixel-linkedin", rows: LINKEDIN_ROWS },
  aragi: {
    cls: "pixel-wordmark",
    rows: ARAGI_ROWS,
    wordmark: { text: "ARAGI", anchor: "hero" },
  },
  info: {
    cls: "pixel-wordmark",
    rows: INFO_ROWS,
    wordmark: { text: "INFO", anchor: "info" },
  },
};
