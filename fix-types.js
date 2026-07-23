const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, 'backend', 'src', 'controllers');

const files = fs.readdirSync(controllersDir);

files.forEach(file => {
  if (file.endsWith('.ts')) {
    const filePath = path.join(controllersDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Replacements
    content = content.replace(/const\s+\{\s*id\s*\}\s*=\s*req\.params;/g, 'const id = String(req.params.id);');
    content = content.replace(/const\s+\{\s*channelId\s*\}\s*=\s*req\.params;/g, 'const channelId = String(req.params.channelId);');
    content = content.replace(/const\s+\{\s*id,\s*itemId\s*\}\s*=\s*req\.params;/g, 'const id = String(req.params.id); const itemId = String(req.params.itemId);');
    content = content.replace(/const\s+\{\s*slug\s*\}\s*=\s*req\.params;/g, 'const slug = String(req.params.slug);');
    
    // Also cases like req.params.channelId directly passed
    content = content.replace(/\(req\.params\.channelId\)/g, '(String(req.params.channelId))');
    content = content.replace(/\(req\.params\.id\)/g, '(String(req.params.id))');

    fs.writeFileSync(filePath, content, 'utf-8');
  }
});
console.log('Fixed controllers!');
