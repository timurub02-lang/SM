#!/usr/bin/python3
"""Refresh personal CRM SIP accounts. Run as root; never logs credentials."""
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import grp
spec=importlib.util.spec_from_file_location('crm_call',Path(__file__).with_name('crm-call.py'))
call=importlib.util.module_from_spec(spec)
spec.loader.exec_module(call)
os.umask(0o077)
accounts=call.api('GET',accounts=True)['accounts']
blocks=[]
for account in accounts:
    user,password=account['username'],account['password']
    assert re.fullmatch(r'crm-[a-f0-9]{24}',user) and re.fullmatch(r'[a-f0-9]{64}',password)
    blocks.append(f"""[{user}]
type=endpoint
transport=transport-wss
context=crm-browser-staff
disallow=all
allow=alaw,ulaw
auth={user}
aors={user}
webrtc=yes
dtls_auto_generate_cert=yes
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
allow_transfer=no
rtp_timeout=30
rtp_timeout_hold=1800
[{user}]
type=auth
auth_type=userpass
username={user}
password={password}
[{user}]
type=aor
max_contacts=1
remove_existing=yes
""")
path=Path('/etc/asterisk/crm-browser-staff.conf')
content='\n'.join(blocks)
if not path.exists() or path.read_text()!=content:
    temp=path.with_suffix('.tmp')
    temp.write_text(content)
    temp.chmod(0o640)
    os.chown(temp,0,grp.getgrnam('asterisk').gr_gid)
    temp.replace(path)
    subprocess.run(['asterisk','-rx','pjsip reload'],check=True,stdout=subprocess.DEVNULL)
print('Personal CRM phone accounts: '+str(len(accounts)))
