'use client';
import {ArrowLeft,Headphones} from 'lucide-react';
import {SidebarProvider,Sidebar,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarInset,SidebarTrigger} from '@/components/ui/sidebar';

export default function OktellEmpty({testOnly=false,operator=false}:{testOnly?:boolean;operator?:boolean}){
 return <SidebarProvider>
  <Sidebar className="sidebar">
   <SidebarHeader><a className="brand" href={testOnly?'/oktell':'/'}><span className="brand-mark">см</span><b>CRM<span>КЛИЕНТЫ И ЗАКАЗЫ</span></b></a></SidebarHeader>
   <SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive className={operator?"operator-calls-nav":undefined}><span className="nav-icon oktell"><Headphones/></span><span>{operator?'Звонки':'Oktell'}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent>
   <SidebarFooter>{!testOnly&&<a href="/" className="secondary"><ArrowLeft size={16}/>Вернуться в CRM</a>}<a href="/login" className="secondary">Сменить пользователя</a></SidebarFooter>
  </Sidebar>
  <SidebarInset>
   <header className="topbar"><span><SidebarTrigger className="mobile-trigger"/>Рабочее пространство · Oktell</span></header>
   <main className="workspace-content">
    <div className="page-heading"><div><h1>{operator?'Звонки':'Oktell'}</h1></div></div>
    <section className="empty" aria-labelledby="oktell-empty-title" style={{color:'var(--foreground)'}}><Headphones aria-hidden="true"/><h2 id="oktell-empty-title" style={{fontSize:'1.25rem',fontWeight:600}}>Раздел пока пуст</h2><p style={{color:'var(--foreground)',maxWidth:'50ch',marginInline:'auto'}}>Здесь будут появляться настройки и функции Oktell по мере подключения.</p></section>
   </main>
  </SidebarInset>
 </SidebarProvider>;
}
