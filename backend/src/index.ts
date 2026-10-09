import { createApp } from "./app.js";

const { app, db } = createApp();
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`VYBE API: http://127.0.0.1:${port}`);
});
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
