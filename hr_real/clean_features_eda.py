"""Milestone-1 real-data cleaning, feature engineering, and EDA.
No model training. No synthetic fallback.
"""
import json, uuid, statistics
from .db import connect, init_db
HR_EVENTS={'home_run'}
BIP_DESCRIPTIONS={'hit_into_play','hit_into_play_score','hit_into_play_no_out'}

def build_pa_events():
    init_db(); con=connect()
    rows=con.execute("SELECT * FROM statcast_pitches ORDER BY game_date, game_pk, at_bat_number, pitch_number").fetchall()
    by={}
    for r in rows: by.setdefault((r['game_pk'],r['at_bat_number']),[]).append(dict(r))
    out=[]
    for (gp,ab),ps in by.items():
        last=ps[-1]; evs=[p['launch_speed'] for p in ps if p['launch_speed'] is not None]; las=[p['launch_angle'] for p in ps if p['launch_angle'] is not None]
        mix={}; zones={}
        for p in ps:
            if p['pitch_type']: mix[p['pitch_type']]=mix.get(p['pitch_type'],0)+1
            if p['zone'] is not None: zones[str(p['zone'])]=zones.get(str(p['zone']),0)+1
        uid=f"{gp}|{ab}"; event=last.get('events')
        out.append((uid,gp,last['game_date'],last['season'],ab,last['batter'],last['pitcher'],last['stand'],last['p_throws'],len(ps),event,int(any(p.get('description') in BIP_DESCRIPTIONS for p in ps)),int(event in HR_EVENTS),max(evs) if evs else None,las[-1] if las else None,max([p.get('barrel') or 0 for p in ps]),max([p.get('hardhit') or 0 for p in ps]),json.dumps(mix),json.dumps(zones),None))
    con.executemany("INSERT OR REPLACE INTO pa_events VALUES ("+','.join(['?']*20)+")",out); con.commit(); con.close(); return len(out)

def build_features():
    init_db(); con=connect(); con.execute('DELETE FROM feature_rows')
    rows=con.execute("SELECT * FROM pa_events ORDER BY game_date, game_pk, at_bat_number").fetchall()
    hp={}; pp={}; out=[]
    def rate(d,k,n,prior,strength): return ((d.get(k,0)+prior*strength)/(max(0,d.get(n,0))+strength))
    for r in rows:
        b,p=r['batter'],r['pitcher']; hd=hp.get(b,{}); pd=pp.get(p,{})
        f={
          'h_pa_prior':hd.get('pa',0),'h_hr_rate_prior':rate(hd,'hr','pa',0.032,80),'h_barrel_prior':rate(hd,'barrel','bip',0.08,60),'h_hardhit_prior':rate(hd,'hardhit','bip',0.38,60),'h_ev_prior':hd.get('ev_sum',0)/max(1,hd.get('ev_n',0)),
          'p_pa_prior':pd.get('pa',0),'p_hr_rate_prior':rate(pd,'hr','pa',0.032,80),'p_barrel_allowed_prior':rate(pd,'barrel','bip',0.08,60),'p_hardhit_allowed_prior':rate(pd,'hardhit','bip',0.38,60),'p_ev_allowed_prior':pd.get('ev_sum',0)/max(1,pd.get('ev_n',0)),
          'platoon_adv':int((r['stand']=='L' and r['p_throws']=='R') or (r['stand']=='R' and r['p_throws']=='L') or r['stand']=='S'),
          'pitch_count_pa':r['pitch_count']}
        out.append((f"{r['pa_uid']}",r['game_date'],r['season'],r['game_pk'],b,p,r['is_hr'],json.dumps(f)))
        for d in (hd,):
            d['pa']=d.get('pa',0)+1; d['hr']=d.get('hr',0)+r['is_hr']; d['bip']=d.get('bip',0)+r['is_bip']; d['barrel']=d.get('barrel',0)+r['barrel']; d['hardhit']=d.get('hardhit',0)+r['hardhit']
            if r['max_ev'] is not None: d['ev_sum']=d.get('ev_sum',0)+r['max_ev']; d['ev_n']=d.get('ev_n',0)+1
        hp[b]=hd
        for d in (pd,):
            d['pa']=d.get('pa',0)+1; d['hr']=d.get('hr',0)+r['is_hr']; d['bip']=d.get('bip',0)+r['is_bip']; d['barrel']=d.get('barrel',0)+r['barrel']; d['hardhit']=d.get('hardhit',0)+r['hardhit']
            if r['max_ev'] is not None: d['ev_sum']=d.get('ev_sum',0)+r['max_ev']; d['ev_n']=d.get('ev_n',0)+1
        pp[p]=pd
    con.executemany("INSERT OR REPLACE INTO feature_rows(row_id,as_of_date,season,game_pk,batter,pitcher,label_is_hr,features_json) VALUES(?,?,?,?,?,?,?,?)",out); con.commit(); con.close(); return len(out)

def eda_report():
    init_db(); con=connect(); rc={t:con.execute(f'SELECT COUNT(*) c FROM {t}').fetchone()['c'] for t in ['statcast_pitches','pa_events','feature_rows','odds_snapshots']}
    metrics={}
    pa=con.execute('SELECT COUNT(*) n, SUM(is_hr) hr, AVG(max_ev) ev, AVG(launch_angle) la, AVG(barrel) brl, AVG(hardhit) hh FROM pa_events').fetchone()
    if pa and pa['n']:
        metrics={'pa':pa['n'],'hr_rate':(pa['hr'] or 0)/pa['n'],'avg_ev':pa['ev'],'avg_la':pa['la'],'barrel_rate':pa['brl'],'hardhit_rate':pa['hh']}
    quality={'missing_ev':con.execute('SELECT COUNT(*) c FROM pa_events WHERE max_ev IS NULL').fetchone()['c'],'seasons':con.execute('SELECT COUNT(DISTINCT season) c FROM statcast_pitches').fetchone()['c']}
    rid='eda-'+uuid.uuid4().hex[:10]
    con.execute('INSERT OR REPLACE INTO eda_reports(report_id,row_counts_json,metrics_json,quality_json) VALUES(?,?,?,?)',(rid,json.dumps(rc),json.dumps(metrics),json.dumps(quality))); con.commit(); con.close()
    return {'report_id':rid,'row_counts':rc,'metrics':metrics,'quality':quality}

def main():
    print('pa_events', build_pa_events()); print('feature_rows', build_features()); print(json.dumps(eda_report(),indent=2))
if __name__=='__main__': main()
