import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (item !== 'node_modules' && item !== 'dist') {
        walkDir(fullPath, callback);
      }
    } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
      callback(fullPath);
    }
  }
}

walkDir('./src', (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(/from\s+['"](\.{1,3}\/[^'"]*\/types)['"]/g, (match, p1) => {
    return `from '${p1}.ts'`;
  });
  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
});
console.log('Import fix completed.');
