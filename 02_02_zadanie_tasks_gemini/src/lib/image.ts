import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

export async function sliceImage(imagePath: string, outputDir: string): Promise<string[]> {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
        throw new Error('Could not read image metadata');
    }

    const tileWidth = Math.floor(metadata.width / 3);
    const tileHeight = Math.floor(metadata.height / 3);

    const tilePaths: string[] = [];

    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const tileName = `${row + 1}x${col + 1}.png`;
            const outputPath = path.join(outputDir, tileName);
            
            // Ensure we don't exceed image dimensions due to rounding
            const width = (col === 2) ? metadata.width - (col * tileWidth) : tileWidth;
            const height = (row === 2) ? metadata.height - (row * tileHeight) : tileHeight;

            await image
                .clone() // Use clone to avoid issues with multiple extractions from the same instance
                .extract({
                    left: col * tileWidth,
                    top: row * tileHeight,
                    width: width,
                    height: height
                })
                .toFile(outputPath);
            
            tilePaths.push(outputPath);
        }
    }

    return tilePaths;
}
