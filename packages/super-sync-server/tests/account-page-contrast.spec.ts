import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLE_CSS = readFileSync(join(__dirname, '../public/style.css'), 'utf8');

const getCssBlock = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = STYLE_CSS.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

  if (!match) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }

  return match[1];
};

const getCssColor = (selector: string, property: string): string => {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = getCssBlock(selector).match(
    new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`),
  );

  if (!match) {
    throw new Error(`Missing ${property} color for ${selector}`);
  }

  return match[1];
};

const getCssVariable = (cssBlock: string, variableName: string): string => {
  const escapedVariableName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cssBlock.match(
    new RegExp(`(?:^|;)\\s*${escapedVariableName}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`),
  );

  if (!match) {
    throw new Error(`Missing ${variableName} color`);
  }

  return match[1];
};

const getDarkModeRootBlock = (): string => {
  const match = STYLE_CSS.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{([^}]*)\}/,
  );

  if (!match) {
    throw new Error('Missing dark mode :root block');
  }

  return match[1];
};

const hexToRgb = (hexColor: string): [number, number, number] => {
  const normalizedHex = hexColor
    .replace('#', '')
    .replace(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i, '$1$1$2$2$3$3');
  const parsedColor = Number.parseInt(normalizedHex, 16);

  return [(parsedColor >> 16) & 255, (parsedColor >> 8) & 255, parsedColor & 255];
};

const toLinearRgb = (channel: number): number => {
  const normalizedChannel = channel / 255;

  return normalizedChannel <= 0.03928
    ? normalizedChannel / 12.92
    : Math.pow((normalizedChannel + 0.055) / 1.055, 2.4);
};

const getRelativeLuminance = (hexColor: string): number => {
  const [red, green, blue] = hexToRgb(hexColor).map(toLinearRgb);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const getContrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
};

describe('SuperSync account page contrast', () => {
  it('keeps badge text above WCAG AA normal-text contrast', () => {
    const foreground = getCssColor('.beta-badge', 'color');
    const background = getCssColor('.beta-badge', 'background-color');

    expect(getContrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps dark-mode hover link text above WCAG AA normal-text contrast', () => {
    const darkModeRoot = getDarkModeRootBlock();
    const foreground = getCssVariable(darkModeRoot, '--primary-dark');
    const background = getCssVariable(darkModeRoot, '--card-bg');

    expect(getContrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
