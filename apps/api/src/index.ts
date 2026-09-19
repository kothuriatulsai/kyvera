import "dotenv/config";
import { createApp } from "./app";
import { assertAuthConfig } from "./config";

// Fail on boot, not on the first login, if auth is misconfigured.
assertAuthConfig();

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = createApp();

app.listen(port, () => {
  console.log(`Kyvera API listening on port ${port}`);
});
