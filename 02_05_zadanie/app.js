import { runMission } from "./src/mission.js";

const main = async () => {
  const result = await runMission();

  console.log("\n=== Mission completed ===");
  console.log(`Dam sector: column=${result.sector.column}, row=${result.sector.row}`);
  console.log(`Flag: ${result.flag}`);
  console.log(`Total attempts: ${result.attempts.length}`);
};

main().catch((error) => {
  console.error("\nMission failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
