import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

const rootFiles = [
  "admin-login.html",
  "admin.html",
  "approved-orders.html",
  "book-room.html",
  "booking-status.html",
  "event-booking.html",
  "event-hall.html",
  "index.html",
  "order-status.html",
  "restaurant-menu.html",
  "restaurant-order.html",
  "restaurant.html",
  "room-booking.html",
  "stripe-cancel.html",
  "stripe-success.html",
];

const directories = ["admin", "admin-login", "assets", "book-room", "public", "restaurant-order", "src"];
const shouldCopy = (source) => !source.endsWith(".DS_Store");

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

for (const file of rootFiles) {
  if (existsSync(join(root, file))) {
    await cp(join(root, file), join(dist, file));
  }
}

for (const directory of directories) {
  if (existsSync(join(root, directory))) {
    await cp(join(root, directory), join(dist, directory), {
      filter: shouldCopy,
      recursive: true,
    });
  }
}

console.log("Static Harla Hotel site built to dist/");
