'use client';
import {useEffect,useState} from 'react';

export function readSessionTab(key:string|null){
 try{return key===null?null:window.sessionStorage.getItem(key);}catch{return null;}
}
export function writeSessionTab(key:string|null,value:string){
 try{if(key!==null)window.sessionStorage.setItem(key,value);}catch{}
}

// Save navigation only on user actions: initial renders must not overwrite it.
export function useSessionTab<T extends string>(key:string|null,fallback:T,allowed?:readonly T[]){
 const [saved,setSaved]=useState<{key:string|null;value:string|null}|null>(null);
 useEffect(()=>{setSaved({key,value:readSessionTab(key)});},[key]);
 const value=saved?.key===key?saved?.value:null;
 const selected=value!==null&&value!==undefined&&(!allowed||allowed.includes(value as T))?value as T:fallback;
 function select(value:T){
  setSaved({key,value});
  writeSessionTab(key,value);
 }
 return [selected,select] as const;
}
