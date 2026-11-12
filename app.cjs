// cPanel/Passenger CommonJS startup bridge. Build before starting the application.
import("./dist/server/main.js").catch(() => {
  console.error(
    "Application startup failed. Check configuration and database connectivity.",
  );
  process.exit(1);
});
