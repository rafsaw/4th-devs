# Task: Electricity (AI Devs 4)

This project solves the `electricity` task by rotating tiles on a 3x3 grid to connect power plants to the source.

## Project Structure

- `src/lib/hub.ts`: API client for the Hub (download/rotate).
- `src/lib/image.ts`: Image processing (slicing 3x3 into 1x1 tiles).
- `src/lib/vision.ts`: Gemini 1.5 Flash integration for tile analysis.
- `src/lib/engine.ts`: Logic for calculating required rotations.
- `src/index.ts`: Main orchestration script.
- `data/`: Directory for images (current state and target state).

## Prerequisites

1.  **API Keys**: Ensure `.env` in the root directory contains:
    - `AI_DEVS_4_KEY`: Your task API key.
    - `GEMINI_API_KEY`: Your Google Gemini API key.
2.  **Target Image**: Place the solved state image at `data/solved_electricity.png`.
3.  **Dependencies**: Run `npm install` in this directory.

## How to Run

1.  Put the target image (`solved_electricity.png`) in the `data/` folder.
2.  Run the solution:
    ```bash
    npm start
    ```

## Logic

The script slices both the current and target boards into 9 tiles each. It then uses Gemini to describe the connections (top, right, bottom, left) for each tile. By comparing these descriptions, it calculates the number of 90-degree rotations needed to match the target.
