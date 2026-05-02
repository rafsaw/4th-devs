import { downloadBoard, rotateTile } from './lib/hub.js';
import { sliceImage } from './lib/image.js';
import { describeTilePair } from './lib/vision.js';
import { calculateRequiredRotations } from './lib/engine.js';
import path from 'path';
import fs from 'fs';

async function main() {
    const targetBoardPath = path.join(process.cwd(), 'data', 'solved_electricity.png');
    
    if (!fs.existsSync(targetBoardPath)) {
        console.error(`Error: Target image not found at ${targetBoardPath}.`);
        process.exit(1);
    }

    console.log("Resetting board and starting Surgical Precision Mode...");
    let currentBoardPath = await downloadBoard(true); // reset=true
    
    const targetTilesDir = path.join(process.cwd(), 'data', 'target');
    await sliceImage(targetBoardPath, targetTilesDir);

    const grid = [
        ['1x1', '1x2', '1x3'],
        ['2x1', '2x2', '2x3'],
        ['3x1', '3x2', '3x3']
    ];

    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const tileId = grid[r][c];
            console.log(`\n--- Processing tile ${tileId} ---`);
            
            // Re-slice current board every tile to be 100% sure
            const currentTilesDir = path.join(process.cwd(), 'data', 'current');
            await sliceImage(currentBoardPath, currentTilesDir);

            const currentPath = path.join(currentTilesDir, `${tileId}.png`);
            const targetPath = path.join(targetTilesDir, `${tileId}.png`);
            
            try {
                const comparison = await describeTilePair(currentPath, targetPath);
                console.log(`Tile ${tileId}: current=${comparison.current}, target=${comparison.target}`);
                
                const rotations = calculateRequiredRotations(comparison.current, comparison.target);
                
                if (rotations > 0) {
                    console.log(`Rotating tile ${tileId} ${rotations} times...`);
                    for (let i = 0; i < rotations; i++) {
                        const result = await rotateTile(tileId);
                        console.log(`Rotation ${i + 1}/${rotations} for ${tileId}:`, result);
                        if (result.message && result.message.includes('FLG:')) {
                            console.log("!!! FLAG FOUND !!!", result.message);
                            fs.writeFileSync(path.join(process.cwd(), 'flag.txt'), result.message);
                            console.log("Flag safely saved to flag.txt");
                            process.exit(0);
                        }
                    }
                    // After rotations, update current board image
                    currentBoardPath = await downloadBoard(false);
                } else {
                    console.log(`Tile ${tileId} is already correct.`);
                }
            } catch (e: any) {
                console.error(`Error processing tile ${tileId}: ${e.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log("Surgical run complete. Downloading final board...");
    await downloadBoard();
}

main().catch(console.error);
