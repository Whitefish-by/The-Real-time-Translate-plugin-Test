import "dotenv/config";
import { readConfig } from "./config";
import { createGateway } from "./server";

const config = readConfig();
const gateway = await createGateway(config);
const address = gateway.server.address();
console.info(JSON.stringify({ event: "gateway_started", address, provider: config.provider }));

async function shutdown(): Promise<void> {
  await gateway.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
