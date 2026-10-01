import {env} from "cloudflare:workers";
export function db(){if(!env.DB)throw new Error("Хранилище пока недоступно. Повторите позже.");return env.DB;}
