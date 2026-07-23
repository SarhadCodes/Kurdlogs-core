const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, regex, replacement) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(regex, replacement);
  fs.writeFileSync(filePath, content, 'utf-8');
}

const controllersDir = path.join(__dirname, 'backend', 'src', 'controllers');

// Fix database.ts
const dbPath = path.join(__dirname, 'backend', 'src', 'config', 'database.ts');
let dbContent = fs.readFileSync(dbPath, 'utf-8');
dbContent = dbContent.replace(/\(e\)/g, '(e: any)');
fs.writeFileSync(dbPath, dbContent, 'utf-8');

// Fix stream.routes.ts
const streamPath = path.join(__dirname, 'backend', 'src', 'routes', 'stream.routes.ts');
let streamContent = fs.readFileSync(streamPath, 'utf-8');
streamContent = streamContent.replace(/t =>/g, '(t: any) =>');
fs.writeFileSync(streamPath, streamContent, 'utf-8');

// Fix controllers
const controllers = fs.readdirSync(controllersDir);
controllers.forEach(file => {
  if (file.endsWith('.ts')) {
    const filePath = path.join(controllersDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Replace req.params usages
    content = content.replace(/req\.params\.id/g, 'String(req.params.id)');
    content = content.replace(/req\.params\.channelId/g, 'String(req.params.channelId)');
    content = content.replace(/req\.params\.itemId/g, 'String(req.params.itemId)');
    
    // Fix String(String(...)) if any got double wrapped
    content = content.replace(/String\(String\(/g, 'String(');
    content = content.replace(/\)\)/g, ')'); 
    
    fs.writeFileSync(filePath, content, 'utf-8');
  }
});
console.log("Done fixing remaining TS errors");
