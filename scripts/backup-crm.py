#!/usr/bin/env python3
"""Admin-installed daily SQLite backups; independent of CRM runtime releases."""
import datetime
import os
import pathlib
import re
import sqlite3

SOURCES={'crm':'/var/lib/sm-crm/crm.sqlite','pilot':'/var/lib/sm-oktell-bridge/pilot.sqlite'}
ROOT=pathlib.Path('/srv/crm/backups/daily')

def backup():
    os.umask(0o077)
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    day=datetime.datetime.now(datetime.timezone.utc).date()
    for name,path in SOURCES.items():
        target=ROOT/(day.isoformat()+'-'+name+'.sqlite')
        temp=target.with_suffix('.tmp')
        try:
            source=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
            saved=sqlite3.connect(temp)
            try:
                source.backup(saved)
                if saved.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                    raise RuntimeError('Backup integrity failed: '+name)
            finally:
                saved.close();source.close()
            with temp.open('r+b') as f:os.fsync(f.fileno())
            os.replace(temp,target)
        finally:
            temp.unlink(missing_ok=True)
    # Prune only our own dated files, after every source succeeded.
    for p in ROOT.iterdir():
        match=re.fullmatch(r'(\d{4}-\d{2}-\d{2})-(crm|pilot)\.sqlite',p.name)
        if match and not p.is_symlink() and datetime.date.fromisoformat(match[1])<day-datetime.timedelta(days=6):
            p.unlink()
    print('Verified daily CRM and bridge SQLite backups')

if __name__=='__main__':backup()
