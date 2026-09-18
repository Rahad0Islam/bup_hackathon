import fs from 'fs'
import path from 'path';

const moduleName = process.argv[2];

if (!moduleName) {
  console.error("❌ Please provide a module name.");
  console.log("Example: npm run generate user");
  process.exit(1);
}

const targetDir = path.join(
  process.cwd(),
  "src",
  "modules",
  moduleName
);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const files = [
  `${moduleName}.controller.ts`,
  `${moduleName}.service.ts`,
  `${moduleName}.route.ts`,
  `${moduleName}.validation.ts`,
  `${moduleName}.interface.ts`,
];

files.forEach((file) => {
  const filePath = path.join(targetDir, file);

  if (fs.existsSync(filePath)) {
    console.log(`⚠️ ${file} already exists`);
    return;
  }

  fs.writeFileSync(filePath, "");
  console.log(`✅ Created: ${file}`);
});

console.log(`\n🎉 ${moduleName} module created successfully!`);