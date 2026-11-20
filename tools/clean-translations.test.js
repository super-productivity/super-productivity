const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanObject,
  getAllKeys,
  isLocaleOnlyPluralForm,
} = require('./clean-translations');

// en.json can only ever carry ONE and OTHER, so a locale needing FEW or MANY
// has keys the reference cannot contain.
const EN = {
  F: {
    SCHEDULE: { MORE_EVENTS: { ONE: '1 more event', OTHER: '{{n}} more events' } },
    OTHER_THING: { TITLE: 'Title' },
  },
};

test('keeps a plural form the reference locale has no category for', () => {
  const validKeys = getAllKeys(EN);
  const ro = {
    F: {
      SCHEDULE: {
        MORE_EVENTS: {
          ONE: 'încă un eveniment',
          FEW: 'încă {{n}} evenimente',
          OTHER: 'încă {{n}} de evenimente',
        },
      },
    },
  };

  assert.deepEqual(cleanObject(ro, validKeys), ro);
});

test('still removes keys that are genuinely gone from the reference', () => {
  const validKeys = getAllKeys(EN);
  const locale = {
    F: {
      SCHEDULE: { MORE_EVENTS: { ONE: 'a', FEW: 'b' }, REMOVED_STRING: 'gone' },
      DELETED_SECTION: { TITLE: 'gone too' },
    },
  };

  assert.deepEqual(cleanObject(locale, validKeys), {
    F: { SCHEDULE: { MORE_EVENTS: { ONE: 'a', FEW: 'b' } } },
  });
});

test('does not keep a plural-looking key whose string is gone from the reference', () => {
  const validKeys = getAllKeys(EN);
  const locale = { F: { SCHEDULE: { DROPPED_STRING: { FEW: 'b' } } } };

  assert.deepEqual(cleanObject(locale, validKeys), {});
});

test('isLocaleOnlyPluralForm only accepts CLDR categories under a live parent', () => {
  const validKeys = getAllKeys(EN);

  assert.equal(isLocaleOnlyPluralForm('F.SCHEDULE.MORE_EVENTS.FEW', validKeys), true);
  assert.equal(isLocaleOnlyPluralForm('F.SCHEDULE.MORE_EVENTS.MANY', validKeys), true);
  // not a plural category
  assert.equal(isLocaleOnlyPluralForm('F.SCHEDULE.MORE_EVENTS.SOME', validKeys), false);
  // parent no longer exists in the reference
  assert.equal(isLocaleOnlyPluralForm('F.GONE.FEW', validKeys), false);
  // top-level key with no parent path
  assert.equal(isLocaleOnlyPluralForm('FEW', validKeys), false);
});

test('requiring the module does not rewrite the i18n files', () => {
  // `cleanObject` above already exercised the module; if requiring it had run
  // the script, the real locale files would have been rewritten by now. This
  // asserts the guard exists rather than relying on that side effect.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'clean-translations.js'),
    'utf8',
  );
  assert.match(source, /require\.main === module/);
});
