import sharp from 'sharp';
import path from 'path';

async function check() {
    const images = ['data/electricity.png', 'data/solved_electricity.png'];
    for (const imgPath of images) {
        try {
            const metadata = await sharp(imgPath).metadata();
            console.log(`${imgPath}: ${metadata.width}x${metadata.height}`);
        } catch (e) {
            console.error(`Error reading ${imgPath}:`, e);
        }
    }
}
check();
