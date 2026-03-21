import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('./icon.svg');

await sharp(svg).resize(192, 192).png().toFile('./icon-192.png');
await sharp(svg).resize(512, 512).png().toFile('./icon-512.png');

console.log('Íconos generados: icon-192.png y icon-512.png');