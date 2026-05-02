import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const API_KEY = process.env.AI_DEVS_4_KEY;
const BASE_URL = 'https://hub.ag3nts.org';

export async function downloadBoard(reset = false): Promise<string> {
    const url = `${BASE_URL}/data/${API_KEY}/electricity.png${reset ? '?reset=1' : ''}`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const filePath = path.join(process.cwd(), 'data', 'electricity.png');
    fs.writeFileSync(filePath, response.data);
    return filePath;
}

export async function rotateTile(tileId: string): Promise<any> {
    const url = `${BASE_URL}/verify`;
    const response = await axios.post(url, {
        apikey: API_KEY,
        task: 'electricity',
        answer: {
            rotate: tileId
        }
    });
    return response.data;
}
