import { containsEmoji, extractFirstEmoji, isSingleEmoji } from './extract-first-emoji';

describe('extractFirstEmoji', () => {
  it('should extract the first emoji from a string with multiple emojis', () => {
    expect(extractFirstEmoji('😀🚀✅')).toBe('😀');
    expect(extractFirstEmoji('🎉🎊🎈')).toBe('🎉');
    expect(extractFirstEmoji('❤️💙💚')).toBe('❤️');
  });

  it('should extract the first emoji from a string with emojis and text', () => {
    expect(extractFirstEmoji('Hello 😀 world')).toBe('😀');
    expect(extractFirstEmoji('🚀 Rocket ship')).toBe('🚀');
    expect(extractFirstEmoji('Task ✅ completed')).toBe('✅');
  });

  it('should return empty string for strings without emojis', () => {
    expect(extractFirstEmoji('Hello world')).toBe('');
    expect(extractFirstEmoji('123')).toBe('');
    expect(extractFirstEmoji('')).toBe('');
  });

  it('should not treat plain # or digits as emoji', () => {
    expect(extractFirstEmoji('#channel')).toBe('');
    expect(extractFirstEmoji('3 items')).toBe('');
  });

  it('should handle null/undefined/non-string gracefully', () => {
    expect(extractFirstEmoji(null as any)).toBe('');
    expect(extractFirstEmoji(undefined as any)).toBe('');
    expect(extractFirstEmoji(123 as any)).toBe('');
  });

  it('should handle edge cases', () => {
    expect(extractFirstEmoji('   ')).toBe('');
    expect(extractFirstEmoji('😀')).toBe('😀');
    expect(extractFirstEmoji('😀 ')).toBe('😀');
  });

  it('should handle emojis with skin tone modifiers', () => {
    expect(extractFirstEmoji('👍🏻👍🏿')).toBe('👍🏻');
    expect(extractFirstEmoji('👋🏽 Hello')).toBe('👋🏽');
  });

  it('should handle ZWJ (Zero-Width Joiner) emojis', () => {
    expect(extractFirstEmoji('🧑‍💻 coding')).toBe('🧑‍💻');
    expect(extractFirstEmoji('👨‍👩‍👧‍👦 family')).toBe('👨‍👩‍👧‍👦');
    expect(extractFirstEmoji('🏳️‍🌈 pride')).toBe('🏳️‍🌈');
    expect(extractFirstEmoji('👩‍🔬 scientist')).toBe('👩‍🔬');
  });

  it('should handle flag emojis', () => {
    expect(extractFirstEmoji('🇺🇸 USA')).toBe('🇺🇸');
    expect(extractFirstEmoji('🇩🇪 Germany')).toBe('🇩🇪');
  });

  it('should handle keycap emojis', () => {
    expect(extractFirstEmoji('#️⃣ number')).toBe('#️⃣');
    expect(extractFirstEmoji('0️⃣ zero')).toBe('0️⃣');
  });

  it('should handle ZWJ emojis with skin tone', () => {
    expect(extractFirstEmoji('👩🏽‍💻 developer')).toBe('👩🏽‍💻');
  });
});

describe('isSingleEmoji', () => {
  it('should return true for single emojis', () => {
    expect(isSingleEmoji('😀')).toBe(true);
    expect(isSingleEmoji('🚀')).toBe(true);
    expect(isSingleEmoji('✅')).toBe(true);
  });

  it('should return true for emojis with skin tone modifiers', () => {
    expect(isSingleEmoji('👍🏻')).toBe(true);
    expect(isSingleEmoji('👋🏽')).toBe(true);
  });

  it('should return false for multiple emojis', () => {
    expect(isSingleEmoji('😀🚀')).toBe(false);
    expect(isSingleEmoji('🎉🎊')).toBe(false);
  });

  it('should return false for emojis with text', () => {
    expect(isSingleEmoji('😀 Hello')).toBe(false);
    expect(isSingleEmoji('Hello 😀')).toBe(false);
  });

  it('should return false for non-emoji strings', () => {
    expect(isSingleEmoji('Hello')).toBe(false);
    expect(isSingleEmoji('123')).toBe(false);
    expect(isSingleEmoji('')).toBe(false);
  });

  it('should return false for plain # or digits', () => {
    expect(isSingleEmoji('#')).toBe(false);
    expect(isSingleEmoji('3')).toBe(false);
  });

  it('should handle null/undefined/non-string gracefully', () => {
    expect(isSingleEmoji(null as any)).toBe(false);
    expect(isSingleEmoji(undefined as any)).toBe(false);
    expect(isSingleEmoji(123 as any)).toBe(false);
  });

  it('should return true for variation selector emoji', () => {
    expect(isSingleEmoji('❤️')).toBe(true);
  });

  it('should handle edge cases', () => {
    expect(isSingleEmoji('   ')).toBe(false);
    expect(isSingleEmoji('😀 ')).toBe(true); // Trimming removes the space
  });

  it('should return true for ZWJ emojis', () => {
    expect(isSingleEmoji('🧑‍💻')).toBe(true);
    expect(isSingleEmoji('👨‍👩‍👧‍👦')).toBe(true);
    expect(isSingleEmoji('🏳️‍🌈')).toBe(true);
    expect(isSingleEmoji('👩‍🔬')).toBe(true);
  });

  it('should return true for flag emojis', () => {
    expect(isSingleEmoji('🇺🇸')).toBe(true);
    expect(isSingleEmoji('🇩🇪')).toBe(true);
  });

  it('should return true for keycap emojis', () => {
    expect(isSingleEmoji('#️⃣')).toBe(true);
    expect(isSingleEmoji('0️⃣')).toBe(true);
  });

  it('should return true for ZWJ emojis with skin tone', () => {
    expect(isSingleEmoji('👩🏽‍💻')).toBe(true);
  });

  it('should return false for abusive ZWJ chains', () => {
    // Create an artificially long ZWJ chain (20 emojis joined)
    const abuse = Array(20).fill('🧑').join('\u200D');
    expect(isSingleEmoji(abuse)).toBe(false);
  });
});

describe('containsEmoji', () => {
  it('should return true for strings containing emojis', () => {
    expect(containsEmoji('Hello 😀 world')).toBe(true);
    expect(containsEmoji('🚀 Launch!')).toBe(true);
    expect(containsEmoji('Complete ✅')).toBe(true);
    expect(containsEmoji('😀🚀✅')).toBe(true);
  });

  it('should return true for strings with just emojis', () => {
    expect(containsEmoji('😀')).toBe(true);
    expect(containsEmoji('🚀')).toBe(true);
    expect(containsEmoji('✅')).toBe(true);
  });

  it('should return false for strings without emojis', () => {
    expect(containsEmoji('Hello world')).toBe(false);
    expect(containsEmoji('123')).toBe(false);
    expect(containsEmoji('folder')).toBe(false);
    expect(containsEmoji('')).toBe(false);
    expect(containsEmoji('   ')).toBe(false);
  });

  it('should return false for plain # or digits', () => {
    expect(containsEmoji('#channel')).toBe(false);
    expect(containsEmoji('dial 1')).toBe(false);
  });

  it('should handle complex emojis', () => {
    expect(containsEmoji('Love ❤️ you')).toBe(true);
    expect(containsEmoji('Great job 👍🏻')).toBe(true);
    expect(containsEmoji('Star ⭐ rating')).toBe(true);
  });

  it('should detect ZWJ emojis in mixed text', () => {
    expect(containsEmoji('The 🧑‍💻 is coding')).toBe(true);
    expect(containsEmoji('Family: 👨‍👩‍👧‍👦')).toBe(true);
  });

  it('should detect keycap emojis in mixed text', () => {
    expect(containsEmoji('Press #️⃣ to continue')).toBe(true);
  });

  it('should handle null/undefined gracefully', () => {
    expect(containsEmoji(null as any)).toBe(false);
    expect(containsEmoji(undefined as any)).toBe(false);
    expect(containsEmoji(123 as any)).toBe(false);
  });
});
