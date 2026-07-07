"""Real Statcast ingestion. Synthetic data is forbidden here.
Run on Render/your machine with network:
  python -m hr_real.ingest_statcast --season 2024
  python -m hr_real.ingest_statcast --start 2024-03-28 --end 2024-10-01
Requires: pybaseball pandas
"""
import argparse, json, math
from datetime import date, datetime, timedelta
from .db import connect, init_db

def chunks(start, end, days):
    s=datetime.fromisoformat(start).date(); e=datetime.fromisoformat(end).date()
    while s<=e:
        x=min(e,s+timedelta(days=days-1)); yield s.isoformat(), x.isoformat(); s=x+timedelta(days=1)

def barrel(ev, la):
    try: ev=float(ev); la=float(la)
    except Exception: return 0
    return int(ev>=98 and (26-(ev-98)) <= la <= (30+(ev-98)))
def hardhit(ev):
    try: return int(float(ev)>=95)
    except Exception: return 0

def val(r,k):
    v = r.get(k)
    if v is None: return None
    try:
        if isinstance(v,float) and math.isnan(v): return None
    except Exception: pass
    return v

def ingest_range(start, end):
    from pybaseball import statcast
    init_db(); con=connect(); seen=inserted=0
    run=con.execute("INSERT INTO ingest_runs(source,start_date,end_date,status) VALUES(?,?,?,'running')",('statcast',start,end)).lastrowid; con.commit()
    try:
        for a,b in chunks(start,end,int(__import__('os').environ.get('STATCAST_CHUNK_DAYS','7'))):
            df=statcast(start_dt=a,end_dt=b)
            rows=[]; games={}
            for _,r in df.iterrows():
                rr=r.to_dict(); seen+=1
                gp=val(rr,'game_pk'); ab=val(rr,'at_bat_number'); pn=val(rr,'pitch_number')
                uid=f"{gp}|{ab}|{pn}"
                gd=str(val(rr,'game_date') or '')[:10]; season=int(str(gd)[:4]) if gd else val(rr,'game_year')
                games[gp]=(gp,gd,season,val(rr,'home_team'),val(rr,'away_team'),val(rr,'home_team'),val(rr,'game_type'),None)
                ev=val(rr,'launch_speed'); la=val(rr,'launch_angle')
                rows.append((uid,gp,gd,season,ab,pn,val(rr,'batter'),val(rr,'pitcher'),val(rr,'player_name'),None,val(rr,'stand'),val(rr,'p_throws'),val(rr,'inning'),val(rr,'balls'),val(rr,'strikes'),val(rr,'outs_when_up'),val(rr,'pitch_type'),val(rr,'release_speed'),val(rr,'release_spin_rate'),val(rr,'release_pos_x'),val(rr,'release_pos_y'),val(rr,'release_pos_z'),val(rr,'pfx_x'),val(rr,'pfx_z'),val(rr,'plate_x'),val(rr,'plate_z'),val(rr,'zone'),val(rr,'vx0'),val(rr,'vy0'),val(rr,'vz0'),val(rr,'ax'),val(rr,'ay'),val(rr,'az'),ev,la,val(rr,'hit_distance_sc'),val(rr,'estimated_ba_using_speedangle'),val(rr,'estimated_woba_using_speedangle'),barrel(ev,la),hardhit(ev),val(rr,'bb_type'),val(rr,'description'),val(rr,'events'),val(rr,'type'),val(rr,'home_team'),val(rr,'away_team'),None,json.dumps(rr,default=str)))
            con.executemany("INSERT OR IGNORE INTO games(game_pk,game_date,season,home_team,away_team,park_id,game_type,day_night) VALUES(?,?,?,?,?,?,?,?)", list(games.values()))
            con.executemany("INSERT OR REPLACE INTO statcast_pitches VALUES ("+','.join(['?']*48)+")", rows)
            inserted += len(rows); con.commit(); print(a,b,len(rows))
        con.execute("UPDATE ingest_runs SET status='done', rows_seen=?, rows_inserted=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",(seen,inserted,run)); con.commit()
    except Exception as e:
        con.execute("UPDATE ingest_runs SET status='failed', rows_seen=?, rows_inserted=?, error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",(seen,inserted,str(e),run)); con.commit(); raise
    finally: con.close()
    return {'rows_seen':seen,'rows_inserted':inserted}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--season',type=int); ap.add_argument('--start'); ap.add_argument('--end')
    a=ap.parse_args()
    if a.season: a.start,a.end=f'{a.season}-03-01',f'{a.season}-11-15'
    if not(a.start and a.end): raise SystemExit('provide --season or --start/--end')
    print(ingest_range(a.start,a.end))
if __name__=='__main__': main()
