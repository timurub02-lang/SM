import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const clients=sqliteTable("clients",{id:text("id").primaryKey(),phone:text("phone").notNull().unique(),data:text("data").notNull(),version:integer("version").notNull().default(1)});
export const orders=sqliteTable("orders",{id:text("id").primaryKey(),clientId:text("client_id").notNull().references(()=>clients.id),data:text("data").notNull(),version:integer("version").notNull().default(1)},t=>[index("idx_orders_client").on(t.clientId)]);
export const employees=sqliteTable("employees",{id:text("id").primaryKey(),data:text("data").notNull(),version:integer("version").notNull().default(1)});
export const events=sqliteTable("events",{id:text("id").primaryKey(),clientId:text("client_id").notNull(),orderId:text("order_id").notNull(),at:text("at").notNull(),data:text("data").notNull()},t=>[index("idx_events_client").on(t.clientId)]);
export const settings=sqliteTable("settings",{id:text("id").primaryKey(),data:text("data").notNull()});
