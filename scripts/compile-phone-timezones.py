"""Compile the public numbering registry; never accepts or uploads customer data."""
import argparse, collections, csv, hashlib, json, pathlib, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]

def compile_registry(directory, date):
    datetime.date.fromisoformat(date)
    mapping=json.loads((ROOT/'data/phone-timezones/regions.json').read_text(encoding='utf-8'))
    zones=sorted({z for values in mapping.values() for z in values})
    events=collections.defaultdict(collections.Counter);sources=[];unknown=collections.Counter()
    for name in ['ABC-3xx','ABC-4xx','ABC-8xx','DEF-9xx']:
        path=directory/(name+'.csv');raw=path.read_bytes();count=0
        for row in csv.DictReader(raw.decode('utf-8-sig').splitlines(),delimiter=';'):
            code=row.get('АВС/ DEF','').strip();lo=row.get('От','').strip();hi=row.get('До','').strip()
            if not(code.isdigit() and len(code)==3 and lo.isdigit() and hi.isdigit() and 0<=int(lo)<=int(hi)<=9999999):raise ValueError('Invalid registry range')
            area=row['Территория ГАР'].split('|')[-1].strip()
            parts=[p.strip() for p in area.split(',')]
            if all(p in mapping for p in parts):ids=tuple(sorted({zones.index(z) for p in parts for z in mapping[p]}))
            else:ids=(-1,);unknown[area]+=1
            start=int('7'+code+lo.zfill(7));end=int('7'+code+hi.zfill(7))
            for z in ids:events[start][z]+=1;events[end+1][z]-=1
            count+=1
        if count<100:raise ValueError('Truncated registry '+name)
        sources.append({'url':'https://opendata.digital.gov.ru/downloads/'+name+'.csv','sha256':hashlib.sha256(raw).hexdigest(),'rows':count})
    active=collections.Counter();previous=None;ranges=[]
    for point,delta in sorted(events.items()):
        ids=sorted(k for k,v in active.items() if v>0)
        if previous is not None and ids:
            ids=[] if -1 in ids else ids
            if ranges and ranges[-1][1]+1==previous and ranges[-1][2]==ids:ranges[-1][1]=point-1
            else:ranges.append([previous,point-1,ids])
        active.update(delta)
        if any(v<0 for v in active.values()):raise ValueError('Invalid interval accounting')
        previous=point
    result={'version':1,'asOf':date,'sources':sources,'zones':zones,'ranges':ranges}
    (ROOT/'data/phone-timezones/ranges.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({'ranges':len(ranges),'unknownTerritories':dict(unknown)},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('directory',type=pathlib.Path);p.add_argument('--as-of',required=True);a=p.parse_args();compile_registry(a.directory,a.as_of)
