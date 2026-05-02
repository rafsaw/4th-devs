const DIRECTIONS = ['top', 'right', 'bottom', 'left'] as const;
type Direction = typeof DIRECTIONS[number];

export function rotateConnections(connections: string[], clicks: number): string[] {
    return connections.map(conn => {
        const index = DIRECTIONS.indexOf(conn as Direction);
        return DIRECTIONS[(index + clicks) % 4];
    }).sort();
}

export function calculateRequiredRotations(current: string[], target: string[]): number {
    const sortedTarget = [...target].sort().join(',');
    
    for (let clicks = 0; clicks < 4; clicks++) {
        const rotated = rotateConnections(current, clicks);
        if (rotated.join(',') === sortedTarget) {
            return clicks;
        }
    }
    
    throw new Error(`Cannot reach target state ${target} from current state ${current}`);
}
