// Test parseMarkdownWithSections function
const { parseMarkdownWithSections } = require('./src/app/util/parse-markdown-tasks.ts');

const testMarkdown = `# Backend Tasks
- Setup API routes
- Configure database

# Frontend Tasks  
- Create login component
- Add authentication`;

console.log('Testing parseMarkdownWithSections...');
const result = parseMarkdownWithSections(testMarkdown);
console.log('Result:', JSON.stringify(result, null, 2));
