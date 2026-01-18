const fs = require('fs');

// We will modify the existing 'arbor-adhd.json' which we just created.
// Or we can regenerate it from scratch if needed, but modifying the existing file
// ensures we keep the previous successful changes.
const INPUT_FILE = 'arbor-adhd.json';
const OUTPUT_FILE = 'arbor-adhd-quadrant.json';

// --- IDs for New Tags (Must match previous script) ---
const TAG_QUICK_WIN = 'TAG_QUICK_WIN';
const TAG_DEEP_FOCUS = 'TAG_DEEP_FOCUS';
const TAG_LOW_ENERGY = 'TAG_LOW_ENERGY';
const TAG_FUN = 'TAG_FUN';

try {
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
  const backup = JSON.parse(fileContent);
  const data = backup.data;

  // Find the Dopamine Board we created
  const dopamineBoardIndex = data.boards.boardCfgs.findIndex(
    (b) => b.id === 'DOPAMINE_BOARD',
  );

  if (dopamineBoardIndex !== -1) {
    const board = data.boards.boardCfgs[dopamineBoardIndex];

    // Convert to 2 Columns (Quadrants)
    board.cols = 2;

    // Reorder Panels to simulate Quadrants:
    // Top Left: Quick Wins (Now)
    // Top Right: Deep Focus (Urgent/Important equivalent position)
    // Bottom Left: Low Energy (Soon)
    // Bottom Right: Fun (Later)

    // NOTE: The UI renders panels in order.
    // If cols=2, it fills:
    // Row 1: Panel 1, Panel 2
    // Row 2: Panel 3, Panel 4

    // We need to verify which ID corresponds to which concept:
    // PANEL_QUICK -> Quick Wins (Top Left)
    // PANEL_FOCUS -> Deep Focus (Top Right)
    // PANEL_LOW -> Zombie Mode (Bottom Left)
    // PANEL_FUN -> Rewards (Bottom Right)

    // Let's ensure the order is correct in the array:
    const panels = board.panels;
    const pQuick = panels.find((p) => p.id === 'PANEL_QUICK');
    const pFocus = panels.find((p) => p.id === 'PANEL_FOCUS');
    const pLow = panels.find((p) => p.id === 'PANEL_LOW');
    const pFun = panels.find((p) => p.id === 'PANEL_FUN');

    board.panels = [pQuick, pFocus, pLow, pFun];

    // Update Board Title to reflect new layout
    board.title = '🧠 ADHD Quadrants';

    console.log('Updated Dopamine Board to 4-Quadrant Layout');
  } else {
    console.error('Could not find DOPAMINE_BOARD to update.');
  }

  // Write file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(backup, null, 2));
  console.log(`Successfully generated ${OUTPUT_FILE}`);
} catch (err) {
  console.error('Error processing file:', err);
}
