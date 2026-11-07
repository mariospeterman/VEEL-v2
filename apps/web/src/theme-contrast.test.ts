import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/styles/tokens-base.css", import.meta.url), "utf8");

describe("semantic theme contrast", () => {
  it.each([
    ["dark", tokenBlock(":root")],
    ["light", tokenBlock(':root[data-theme="light"]')]
  ])("keeps accent text readable in the %s theme", (_theme, tokens) => {
    const background = parseHex(tokens.get("--background"));
    const accent = parseHex(tokens.get("--accent"));
    const accentStrong = parseHex(tokens.get("--accent-strong"));
    const accentOnSolid = parseHex(tokens.get("--accent-on-solid"));
    const accentSoft = composite(parseRgba(tokens.get("--accent-soft")), background);

    expect(contrast(accentStrong, accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accentOnSolid, accent)).toBeGreaterThanOrEqual(4.5);
  });
});

function tokenBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match?.[1]) throw new Error(`Missing ${selector} token block`);
  return new Map(
    [...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((entry) => [entry[1]!, entry[2]!.trim()])
  );
}

type Rgb = [number, number, number];

function parseHex(value?: string): Rgb {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Expected a six-digit color, received ${value}`);
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as Rgb;
}

function parseRgba(value?: string): [...Rgb, number] {
  const match = value?.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!match) throw new Error(`Expected rgba(), received ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

function composite([red, green, blue, alpha]: [...Rgb, number], background: Rgb): Rgb {
  return [red, green, blue].map((channel, index) => channel * alpha + background[index]! * (1 - alpha)) as Rgb;
}

function contrast(left: Rgb, right: Rgb) {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

function luminance(color: Rgb) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
