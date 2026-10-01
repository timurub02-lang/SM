import { openDatabase } from "./sqlite";

// Loaded only by the Miran production build; Sites continues using its D1 binding.
let database: ReturnType<typeof openDatabase> | undefined;
export const env = {
  get DB() {
    const path = process.env.CRM_DATABASE_PATH;
    if (!path) throw new Error("CRM_DATABASE_PATH is required");
    return database ??= openDatabase(path);
  },
};
