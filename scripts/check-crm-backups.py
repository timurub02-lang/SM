#!/usr/bin/env python3
"""Administrator-installed, send-only Telegram monitoring of local CRM backups."""
import argparse
import datetime
import json
import math
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import time

ROOT = pathlib.Path('/srv/crm/backups')
POLICY = pathlib.Path('/etc/sm-crm-backup-policy.json')
CONFIG = pathlib.Path('/etc/sm-crm-alerts.json')
STATE = pathlib.Path('/var/lib/sm-crm-alerts/state.json')
REPEAT_SECONDS = 6 * 3600
STALE_SECONDS = 30 * 3600


def protected_json(path, secret=False):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if secret else 0o022):
        raise ValueError('Configuration must be a protected root-owned regular file')
    return json.loads(path.read_text())


def systemd(unit):
    result = subprocess.run(['systemctl', 'show', unit, '-p', 'LoadState,ActiveState,Result'],
                            capture_output=True, text=True, check=True, timeout=10)
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def inspect(root, policy, now, get_unit=systemd):
    disk_limit, backup_limit = policy['warn_disk_percent'], policy['warn_backup_bytes']
    if (type(disk_limit) not in (int, float) or not math.isfinite(disk_limit) or not 1 <= disk_limit <= 100
            or type(backup_limit) is not int or backup_limit <= 0):
        raise ValueError('Invalid monitoring thresholds')
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Missing real backup directory')
    total = 0
    def scan_error(error):
        raise error
    for folder, dirs, files in os.walk(root, followlinks=False, onerror=scan_error):
        dirs[:] = [d for d in dirs if not pathlib.Path(folder, d).is_symlink()]
        for name in files:
            try:
                info = pathlib.Path(folder, name).lstat()
            except FileNotFoundError:
                continue  # Compaction may atomically publish/remove files during the scan.
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    disk = shutil.disk_usage(root)
    percent = disk.used / (disk.used + disk.free) * 100
    problems = {}
    if percent >= disk_limit:
        problems['disk'] = f'Диск занят на {percent:.1f}% (порог {disk_limit}%), свободно {disk.free / 1024**3:.1f} ГиБ.'
    if total > backup_limit:
        problems['backup_size'] = f'Резервные копии занимают {total / 1024**3:.1f} ГиБ (порог {backup_limit / 1024**3:.1f} ГиБ).'
    for name in ('crm', 'pilot'):
        dates = []
        for path in (root / 'daily').glob('*-' + name + '.sqlite'):
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}-' + name + r'\.sqlite', path.name):
                continue
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_size > 0:
                dates.append(info.st_mtime)
        latest = max(dates, default=0)
        if not latest or now - latest > STALE_SECONDS or latest > now + 300:
            problems['stale_' + name] = f'Нет достоверной свежей ежедневной копии {name} за последние 30 часов.'
    service, timer = get_unit('sm-crm-backup.service'), get_unit('sm-crm-backup.timer')
    if service.get('LoadState') != 'loaded':
        problems['backup_service'] = 'Служба резервирования не загружена.'
    elif service.get('ActiveState') == 'failed' or (
            service.get('ActiveState') not in ('active', 'activating') and service.get('Result') != 'success'):
        problems['backup_service'] = 'Последний запуск backup или сжатия завершился ошибкой; проверьте журнал sm-crm-backup.'
    if timer.get('LoadState') != 'loaded' or timer.get('ActiveState') != 'active':
        problems['backup_timer'] = 'Таймер ежедневного резервирования не работает.'
    require_compaction = policy.get('require_compaction_timer', False)
    if type(require_compaction) is not bool:
        raise ValueError('Invalid compaction monitoring policy')
    if require_compaction:
        service = get_unit('sm-crm-backup-compact.service')
        timer = get_unit('sm-crm-backup-compact.timer')
        if service.get('LoadState') != 'loaded' or service.get('ActiveState') == 'failed' or (
                service.get('ActiveState') not in ('active', 'activating') and service.get('Result') != 'success'):
            problems['compaction_service'] = 'Сжатие копий не работает; проверьте журнал sm-crm-backup-compact.'
        if timer.get('LoadState') != 'loaded' or timer.get('ActiveState') != 'active':
            problems['compaction_timer'] = 'Таймер ежечасного сжатия копий не работает.'
    return problems, {'diskPercent': round(percent, 1), 'freeBytes': disk.free, 'backupBytes': total}


def send(config, text):
    if not isinstance(config.get('token'), str) or not re.fullmatch(r'\d+:[A-Za-z0-9_-]{30,}', config['token']):
        raise ValueError('Invalid Telegram credential')
    if type(config.get('chat_id')) is not int or config['chat_id'] >= 0:
        raise ValueError('Expected a group chat identifier')
    # curl is already installed for deployment and supports the site's SOCKS5 proxy.
    # Feed the token-bearing URL/body through stdin, never process arguments.
    request = '\n'.join([
        'url = ' + json.dumps('https://api.telegram.org/bot' + config['token'] + '/sendMessage'),
        'header = "Content-Type: application/json"',
        'data-binary = ' + json.dumps(json.dumps({'chat_id': config['chat_id'], 'text': text})),
    ]) + '\n'
    try:
        response = subprocess.run(['curl', '-q', '--config', '-', '--silent', '--show-error', '--fail',
                                   '--proto', '=https', '--connect-timeout', '8', '--max-time', '20'],
                                  input=request, capture_output=True, text=True, timeout=25, check=True)
        data = json.loads(response.stdout)
        if data.get('ok') is not True or data['result']['chat']['id'] != config['chat_id']:
            raise ValueError('Unexpected delivery response')
        return data['result']['message_id']
    except Exception:
        # Network errors may contain credentials; never propagate or log them.
        raise RuntimeError('Telegram delivery failed; state unchanged, next timer run retries') from None


def notify(problems, previous, now, deliver, test=False):
    keys = sorted(problems)
    changed = keys != previous.get('keys', [])
    repeat = bool(keys) and now - previous.get('sentAt', 0) >= REPEAT_SECONDS
    if test or changed or repeat:
        heading = 'ТЕСТ доставки' if test else ('ПРЕДУПРЕЖДЕНИЕ' if keys else 'ВОССТАНОВЛЕНО')
        detail = '\n'.join(problems.values()) if keys else 'Диск, объём копий, свежесть CRM/pilot и служба backup: проверка пройдена.'
        message_id = deliver('VM100 / CRM — ' + heading + '\n' + detail)
        return {'keys': keys, 'sentAt': now, 'messageId': message_id}, True
    return previous, False


def save_state(path, state):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(state, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='Inspect without sending or changing notification state')
    modes.add_argument('--test', action='store_true', help='Send a test with actual health; leave alert state unchanged')
    args = parser.parse_args()
    os.umask(0o077)
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(STATE.parent / 'lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = time.time()
        try:
            problems, metrics = inspect(ROOT, protected_json(POLICY), now)
        except Exception:
            problems, metrics = {'monitor': 'Не удалось проверить резервирование: требуется проверка журнала службы мониторинга.'}, {}
        if args.check:
            print(json.dumps({'problems': problems, **metrics}, ensure_ascii=False))
            return 2 if problems else 0
        config = protected_json(CONFIG, secret=True)
        previous = protected_json(STATE, secret=True) if STATE.exists() else {}
        updated, sent = notify(problems, previous, now, lambda text: send(config, text), args.test)
        if sent and not args.test:
            save_state(STATE, updated)
        print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          'problems': sorted(problems), 'sent': sent,
                          'messageId': updated.get('messageId') if sent else None, **metrics}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print('Backup monitor failed (' + type(error).__name__ + '); inspect protected configuration and connectivity.')
        raise SystemExit(1) from None
