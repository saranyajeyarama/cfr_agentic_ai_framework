const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'assets');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Dog
const dogSvg = `<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="50" y="80" width="100" height="60" fill="#eab308"/>
  <rect x="40" y="50" width="40" height="40" fill="#eab308"/>
  <rect x="130" y="50" width="15" height="40" fill="#eab308"/>
  <rect x="50" y="140" width="20" height="40" fill="#eab308"/>
  <rect x="130" y="140" width="20" height="40" fill="#eab308"/>
</svg>`;

// Poodle
const poodleSvg = `<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="50" fill="#f97316"/>
  <circle cx="140" cy="60" r="30" fill="#f97316"/>
  <circle cx="60" cy="100" r="25" fill="#f97316"/>
  <circle cx="100" cy="160" r="25" fill="#f97316"/>
  <circle cx="150" cy="150" r="30" fill="#f97316"/>
</svg>`;

// Cat
const catSvg = `<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path d="M 60,150 C 40,150 40,50 100,50 C 160,50 160,150 140,150 Z" fill="#ec4899"/>
  <polygon points="80,55 60,20 100,45" fill="#ec4899"/>
  <polygon points="120,55 140,20 100,45" fill="#ec4899"/>
</svg>`;

async function run() {
  await sharp(Buffer.from(dogSvg)).png().toFile(path.join(dir, 'pet_silhouette_dog_yellow.png'));
  await sharp(Buffer.from(poodleSvg)).png().toFile(path.join(dir, 'pet_silhouette_poodle_orange.png'));
  await sharp(Buffer.from(catSvg)).png().toFile(path.join(dir, 'pet_silhouette_cat_pink.png'));
  console.log('PNGs created successfully in public/assets/');
}

run().catch(console.error);
