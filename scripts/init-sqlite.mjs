import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const path = process.env.CRM_DATABASE_PATH;
if (!path) throw new Error('Set CRM_DATABASE_PATH');
mkdirSync(dirname(path), {recursive: true});
const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clients','orders','employees','events','settings')").all();
  if (tables.length === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql', import.meta.url), 'utf8'));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } else if (tables.length !== 5) {
    throw new Error('Incomplete CRM schema; refusing to overwrite existing data');
  }
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Database integrity check failed');
  console.log('CRM database ready');
} finally { db.close(); }
