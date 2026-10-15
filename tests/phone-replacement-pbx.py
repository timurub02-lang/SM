import importlib.util, tempfile, pathlib, io, contextlib, sys
spec=importlib.util.spec_from_file_location('replacement','scripts/pbx/crm-replacement.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as root:
 m.CACHE=pathlib.Path(root)/'pool.json';m.CACHE.write_text('{"numbers":["79000000001"]}')
 def run(number,result):
  m.api=lambda p:result
  previous=sys.stdin;sys.stdin=io.StringIO('agi_arg_1: '+number+'\n\n'+'200 result=1\n'*10)
  output=io.StringIO()
  try:
   with contextlib.redirect_stdout(output):m.run()
  finally:sys.stdin=previous
  return output.getvalue()
 assert run('79000000002',{})==''
 assert 'CRM_MASK_MODE wait' in run('79000000001',{'mode':'wait'})
 assert 'CRM_MASK_MODE regular' in run('79000000001',{'mode':'free'})
 connected=run('79000000001',{'mode':'connect','destination':'79990000000','callerId':'79000000001'})
 assert 'CRM_MASK_MODE connect' in connected and 'CRM_MASK_DEST 79990000000' in connected
 assert 'CRM_MASK_MODE connect' not in run('79000000001',{'mode':'connect','destination':'evil\ncommand','callerId':'79000000001'})
 assert 'CRM_MASK_MODE connect' not in run('79000000001',{'mode':'connect','destination':'79990000000','callerId':'79000000002'})
print('PBX masking: pool separation, waiting, free number, destination validation passed. No calls placed.')
