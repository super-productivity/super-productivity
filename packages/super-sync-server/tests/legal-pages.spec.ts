import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * The generic image ships no Terms of Service and must publish no privacy policy until
 * the operator identifies themselves as the controller. Everything here guards against
 * an instance re-publishing our legal identity — inherited hosting/mail-processor claims,
 * a supervisory authority in Saxony, or a "[Contact Name]" controller — under a domain we
 * do not run. A third-party public build of our Dockerfile already exists, so this is a
 * live path, not a hypothetical one.
 */

const originalEnv = { ...process.env };
const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Templates live outside public/ so @fastify/static cannot serve them verbatim.
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const PRIVACY_OUTPUT = path.join(PUBLIC_DIR, 'privacy.html');
const INDEX_OUTPUT = path.join(PUBLIC_DIR, 'index.html');

const clearGenerated = (): void => {
  for (const file of [PRIVACY_OUTPUT, INDEX_OUTPUT]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
};

const setFullPrivacyEnv = (): void => {
  process.env.PRIVACY_CONTACT_NAME = 'Test Operator';
  process.env.PRIVACY_ADDRESS_STREET = 'Example Street 1';
  process.env.PRIVACY_ADDRESS_CITY = '12345 Example City';
  process.env.PRIVACY_ADDRESS_COUNTRY = 'Testland';
  process.env.PRIVACY_CONTACT_EMAIL = 'operator@example.test';
};

const importConfig = async () => await import('../src/config');

// Never mkdir inside the repo: createServer creates its dataDir, and leftovers dirtied
// `git status` and could poison a later run.
let tmpDataDirs: string[] = [];
const makeDataDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supersync-legal-'));
  tmpDataDirs.push(dir);
  return dir;
};

describe('legal pages', () => {
  beforeEach(() => {
    resetEnv();
    clearGenerated();
  });

  afterEach(() => {
    resetEnv();
    clearGenerated();
    if (fs.existsSync(path.join(PUBLIC_DIR, 'terms.html'))) {
      fs.rmSync(path.join(PUBLIC_DIR, 'terms.html'));
    }
    for (const dir of tmpDataDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDataDirs = [];
  });

  describe('shipped assets', () => {
    it('ships no Terms of Service in the served directory', () => {
      // Ours name German law, Leipzig as exclusive venue, and our contact address.
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'terms.html'))).toBe(false);
    });

    it('keeps operator-specific claims out of the privacy template', () => {
      const template = fs.readFileSync(
        path.join(TEMPLATE_DIR, 'privacy.template.html'),
        'utf-8',
      );

      for (const claim of [
        'Alfahosting',
        'Ankerstraße',
        'Halle (Saale)',
        'saechsdsb',
        'Saxon Data Protection',
        'exclusively on servers in',
        'German infrastructure',
      ]) {
        expect(template).not.toContain(claim);
      }
    });

    it('keeps our commercial roadmap off the landing page', () => {
      const template = fs.readFileSync(
        path.join(TEMPLATE_DIR, 'index.template.html'),
        'utf-8',
      );

      expect(template).not.toContain('will likely cost');
    });
  });

  describe('PRIVACY_* configuration', () => {
    it('leaves privacy unset when no PRIVACY_* var is given', async () => {
      const { loadConfigFromEnv } = await importConfig();

      expect(loadConfigFromEnv().privacy).toBeUndefined();
    });

    it('rejects partial configuration instead of rendering placeholders', async () => {
      process.env.PRIVACY_CONTACT_NAME = 'Test Operator';
      const { loadConfigFromEnv } = await importConfig();

      expect(() => loadConfigFromEnv()).toThrow(/Incomplete privacy policy/);
    });

    it('names the missing variables in the error', async () => {
      process.env.PRIVACY_CONTACT_NAME = 'Test Operator';
      process.env.PRIVACY_CONTACT_EMAIL = 'operator@example.test';
      const { loadConfigFromEnv } = await importConfig();

      expect(() => loadConfigFromEnv()).toThrow(/PRIVACY_ADDRESS_STREET/);
    });

    it('treats whitespace-only values as unset', async () => {
      setFullPrivacyEnv();
      process.env.PRIVACY_ADDRESS_CITY = '   ';
      const { loadConfigFromEnv } = await importConfig();

      expect(() => loadConfigFromEnv()).toThrow(/PRIVACY_ADDRESS_CITY/);
    });

    it('accepts a complete configuration', async () => {
      setFullPrivacyEnv();
      const { loadConfigFromEnv } = await importConfig();

      expect(loadConfigFromEnv().privacy).toMatchObject({
        contactName: 'Test Operator',
        addressStreet: 'Example Street 1',
        contactEmail: 'operator@example.test',
      });
    });

    it('keeps the optional sections undefined when unset', async () => {
      setFullPrivacyEnv();
      const { loadConfigFromEnv } = await importConfig();
      const privacy = loadConfigFromEnv().privacy;

      expect(privacy?.hostingProvider).toBeUndefined();
      expect(privacy?.supervisoryAuthority).toBeUndefined();
    });
  });

  describe('registration consent enforcement', () => {
    const importApi = async () => await import('../src/api');

    // Regression: `termsAccepted: z.boolean().optional().refine(...)` looks correct but is
    // NOT. In zod 4 an issue raised by a refinement on an optional field is discarded when
    // the key is absent, so a body of {"email":"..."} passed validation on an instance that
    // publishes legal pages — silently removing consent enforcement. `z.literal(true)` has
    // no such hole: an absent key is a type error, not a skipped check.
    it('rejects a body with no termsAccepted key when consent is required', async () => {
      const { buildRegisterBodySchema } = await importApi();
      const schema = buildRegisterBodySchema(true);

      // JSON.parse so the key is genuinely absent, exactly as it arrives over the wire.
      expect(schema.safeParse(JSON.parse('{"email":"user@example.test"}')).success).toBe(
        false,
      );
    });

    it('rejects termsAccepted:false when consent is required', async () => {
      const { buildRegisterBodySchema } = await importApi();

      expect(
        buildRegisterBodySchema(true).safeParse({
          email: 'user@example.test',
          termsAccepted: false,
        }).success,
      ).toBe(false);
    });

    it('accepts termsAccepted:true when consent is required', async () => {
      const { buildRegisterBodySchema } = await importApi();

      expect(
        buildRegisterBodySchema(true).safeParse({
          email: 'user@example.test',
          termsAccepted: true,
        }).success,
      ).toBe(true);
    });

    it('accepts an omitted termsAccepted when consent is not required', async () => {
      const { buildRegisterBodySchema } = await importApi();

      expect(
        buildRegisterBodySchema(false).safeParse(
          JSON.parse('{"email":"user@example.test"}'),
        ).success,
      ).toBe(true);
    });

    it('derives the requirement from whether a privacy policy is configured', async () => {
      const { isConsentRequired, loadConfigFromEnv } = await importConfig();

      expect(isConsentRequired(loadConfigFromEnv())).toBe(false);
      setFullPrivacyEnv();
      expect(isConsentRequired(loadConfigFromEnv())).toBe(true);
    });
  });

  describe('EU hosting badge', () => {
    const importServer = async () => await import('../src/server');

    // The badge names the EU specifically. It is true for our hosted instance and false
    // for a self-hoster anywhere else, so it is opt-in and only EU/EEA unlocks it — an EU
    // flag above "hosted in the US" is the exact class of false claim this work removed.
    it('is absent by default', async () => {
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const index = fs.readFileSync(INDEX_OUTPUT, 'utf-8');
      expect(index).not.toContain('Data hosted in EU');
      expect(index).not.toContain('eu-stars');
    });

    for (const region of ['EU', 'eu', 'EEA']) {
      it(`renders for PRIVACY_DATA_REGION=${region}`, async () => {
        process.env.PRIVACY_DATA_REGION = region;
        const { createServer } = await importServer();
        createServer({ dataDir: makeDataDir() });

        const index = fs.readFileSync(INDEX_OUTPUT, 'utf-8');
        expect(index).toContain('Data hosted in EU');
        expect(index).toContain('eu-stars.svg');
        expect(index).not.toContain('OPTIONAL:');
      });
    }

    for (const region of ['US', 'Germany', 'europe']) {
      it(`stays absent for PRIVACY_DATA_REGION=${region}`, async () => {
        process.env.PRIVACY_DATA_REGION = region;
        const { createServer } = await importServer();
        createServer({ dataDir: makeDataDir() });

        expect(fs.readFileSync(INDEX_OUTPUT, 'utf-8')).not.toContain('Data hosted in EU');
      });
    }

    it('ships the flag asset it references', () => {
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'eu-stars.svg'))).toBe(true);
    });
  });

  describe('privacy.html generation', () => {
    const importServer = async () => await import('../src/server');

    it('writes nothing when the operator is not configured', async () => {
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      expect(fs.existsSync(PRIVACY_OUTPUT)).toBe(false);
    });

    it('omits the consent notice from index.html when no legal pages exist', async () => {
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const index = fs.readFileSync(INDEX_OUTPUT, 'utf-8');
      expect(index).not.toContain('register-terms');
      expect(index).not.toContain('/terms.html');
      // The marker itself must not survive into the served page either.
      expect(index).not.toContain('OPTIONAL:');
    });

    it('renders the controller and keeps the consent notice when configured', async () => {
      setFullPrivacyEnv();
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const privacy = fs.readFileSync(PRIVACY_OUTPUT, 'utf-8');
      expect(privacy).toContain('Test Operator');
      expect(privacy).toContain('Example Street 1');
      expect(privacy).toContain('12345 Example City');
      expect(privacy).not.toContain('{{');
      expect(privacy).not.toContain('[Contact Name]');

      expect(fs.readFileSync(INDEX_OUTPUT, 'utf-8')).toContain('register-terms');
    });

    it('omits the hosting section rather than inheriting a provider', async () => {
      setFullPrivacyEnv();
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const privacy = fs.readFileSync(PRIVACY_OUTPUT, 'utf-8');
      expect(privacy).not.toContain('Art. 28\n        GDPR requires');
      expect(privacy).toContain('are available on request from the');
    });

    it('renders the hosting section when a provider is configured', async () => {
      setFullPrivacyEnv();
      process.env.PRIVACY_HOSTING_PROVIDER = 'Example Hosting GmbH';
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const privacy = fs.readFileSync(PRIVACY_OUTPUT, 'utf-8');
      expect(privacy).toContain('Example Hosting GmbH');
      // States what Art. 28 requires, not that the operator has signed one — we cannot
      // verify that on their behalf.
      expect(privacy).toMatch(/Art\. 28\s+GDPR requires a Data Processing Agreement/);
    });

    it('does not link Terms when the operator supplied none', async () => {
      setFullPrivacyEnv();
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const index = fs.readFileSync(INDEX_OUTPUT, 'utf-8');
      // Consent is still asked for (a policy exists), but a link to a page we do not
      // serve would 404 — and the nested marker must not leak into the served HTML.
      expect(index).toContain('register-terms');
      expect(index).toContain('/privacy.html');
      expect(index).not.toContain('/terms.html');
      expect(index).not.toContain('OPTIONAL:');
    });

    it('links Terms when the operator supplied them', async () => {
      setFullPrivacyEnv();
      const dataDir = makeDataDir();
      fs.mkdirSync(path.join(dataDir, 'legal'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'legal', 'terms.html'),
        '<html>operator terms</html>',
      );

      try {
        const { createServer } = await importServer();
        createServer({ dataDir });

        const index = fs.readFileSync(INDEX_OUTPUT, 'utf-8');
        expect(index).toContain('/terms.html');
        expect(index).not.toContain('OPTIONAL:');

        const served = path.join(PUBLIC_DIR, 'terms.html');
        expect(fs.readFileSync(served, 'utf-8')).toContain('operator terms');
        fs.rmSync(served);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    });

    // `String.replace(re, str)` treats $&, $`, $' as replacement patterns — and escapeHtml
    // MANUFACTURES them, since it rewrites ' into &#039;, so a value like "O$'Brien" produces
    // a literal `$&`. That spliced parts of the template into the <address> element and
    // re-emitted the raw {{ PRIVACY_CONTACT_NAME }} placeholder into a published policy.
    // Function replacers disable $-interpretation; these fail if they are ever inlined again.
    it('does not treat $-sequences in operator values as replacement patterns', async () => {
      setFullPrivacyEnv();
      process.env.PRIVACY_CONTACT_NAME = "O$'Brien $& Co $`Ltd";
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const privacy = fs.readFileSync(PRIVACY_OUTPUT, 'utf-8');
      expect(privacy).not.toContain('{{');
      // `$\`` splices everything preceding the match, which nested a second copy of the
      // whole document inside <address>. Exactly one doctype means nothing was spliced.
      expect(privacy.match(/<!doctype/gi)?.length).toBe(1);
      expect(privacy).toContain('O$&#039;Brien $&amp; Co $`Ltd');
    });

    it('leaves no marker or placeholder residue in either generated page', async () => {
      setFullPrivacyEnv();
      process.env.PRIVACY_HOSTING_PROVIDER = 'Example Hosting GmbH';
      process.env.PRIVACY_SUPERVISORY_AUTHORITY = 'Example Authority';
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      // A typo'd marker matches nothing and would otherwise ship verbatim in a legal page,
      // with BOTH branches of an either/or section surviving. assertFullyRendered turns
      // that into a boot failure; these assertions are the same check from the outside.
      for (const file of [PRIVACY_OUTPUT, INDEX_OUTPUT]) {
        const html = fs.readFileSync(file, 'utf-8');
        expect(html).not.toContain('OPTIONAL:');
        expect(html).not.toMatch(/\{\{[^}]*\}\}/);
      }
    });

    it('escapes operator-supplied values', async () => {
      setFullPrivacyEnv();
      process.env.PRIVACY_CONTACT_NAME = '<script>alert(1)</script>';
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      const privacy = fs.readFileSync(PRIVACY_OUTPUT, 'utf-8');
      expect(privacy).not.toContain('<script>alert(1)</script>');
      expect(privacy).toContain('&lt;script&gt;');
    });

    it('refuses to publish a symlinked terms.html', async () => {
      setFullPrivacyEnv();
      const dataDir = makeDataDir();
      const secret = path.join(dataDir, 'secret.env');
      fs.mkdirSync(path.join(dataDir, 'legal'), { recursive: true });
      fs.writeFileSync(secret, 'JWT_SECRET=supersecret');
      fs.symlinkSync(secret, path.join(dataDir, 'legal', 'terms.html'));

      try {
        const { createServer } = await importServer();
        createServer({ dataDir });

        // copyFileSync follows symlinks, and the destination is served unauthenticated.
        expect(fs.existsSync(path.join(PUBLIC_DIR, 'terms.html'))).toBe(false);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    });

    it('removes a stale policy left by an earlier configured boot', async () => {
      fs.writeFileSync(PRIVACY_OUTPUT, '<html>previous operator</html>');
      const { createServer } = await importServer();
      createServer({ dataDir: makeDataDir() });

      expect(fs.existsSync(PRIVACY_OUTPUT)).toBe(false);
    });
  });
});
