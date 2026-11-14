// Script_Extensions includes Persian letters and Arabic presentation forms.
// Intersect with Letter so Arabic digits, punctuation and marks alone stay LTR.
const ARABIC_LETTER = /(?=\p{Script_Extensions=Arabic})\p{Letter}/u;

/** Mixed Persian/Arabic and Latin prose reads RTL regardless of its first letter. */
export const getTextDirection = (text: string | null | undefined): 'ltr' | 'rtl' =>
  ARABIC_LETTER.test(text ?? '') ? 'rtl' : 'ltr';
