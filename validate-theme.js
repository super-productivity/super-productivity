const fs = require('fs');

const FILE = 'arbor-organized.json';

try {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8')).data;

  console.log('Checking Projects...');
  Object.values(data.project.entities).forEach((p) => {
    if (!p.theme) {
      console.error(`[ERROR] Project ${p.title} (${p.id}) is missing 'theme'`);
    } else if (!p.theme.primary) {
      console.error(`[ERROR] Project ${p.title} (${p.id}) is missing 'theme.primary'`);
    } else {
      console.log(`[OK] Project ${p.title} has theme.primary: ${p.theme.primary}`);
    }
  });

  console.log('\nChecking Tags...');
  Object.values(data.tag.entities).forEach((t) => {
    if (!t.theme) {
      console.error(`[ERROR] Tag ${t.title} (${t.id}) is missing 'theme'`);
    } else if (!t.theme.primary) {
      // Tags might allow null primary? Let's check.
      console.log(
        `[WARN] Tag ${t.title} (${t.id}) has theme.primary: ${t.theme.primary}`,
      );
    } else {
      console.log(`[OK] Tag ${t.title} has theme.primary: ${t.theme.primary}`);
    }
  });
} catch (e) {
  console.error(e);
}
