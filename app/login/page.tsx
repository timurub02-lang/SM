'use client';
import {useState,type FormEvent} from 'react';
export default function Login(){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');const fields=new FormData(e.currentTarget);
  try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:fields.get('login'),password:fields.get('password')})});const data:any=await r.json();if(!r.ok)throw Error(data.error);window.location.replace('/');}
  catch(e){setError(e instanceof Error?e.message:'Не удалось войти');setBusy(false);}
 }
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f5f5f7'}}><form onSubmit={submit} className="stack" style={{width:'100%',maxWidth:400,padding:32,background:'white',borderRadius:20,boxShadow:'0 12px 48px #00000010'}}><h1 style={{fontSize:28,fontWeight:650}}>СМ · CRM</h1><p className="muted">Войдите под своей учётной записью</p><label className="field"><span>Логин</span><input name="login" autoComplete="username" required maxLength={100} autoFocus/></label><label className="field"><span>Пароль</span><input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>{error&&<p role="alert" style={{color:'#c62828'}}>{error}</p>}<button className="primary" disabled={busy}>{busy?'Вход…':'Войти'}</button><p className="muted">Если вход не настроен или вы забыли пароль, обратитесь к администратору.</p></form></main>;
}
