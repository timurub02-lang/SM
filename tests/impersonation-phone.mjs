import assert from 'node:assert/strict';
import {impersonationBlocksPhone} from '../lib/impersonation.ts';
import {mayCallEndpoint} from '../lib/permissions.ts';
import {hasOktellLink} from '../lib/oktell-link.ts';
const actor={id:'operator',role:'operator',oktell:{requested:true,status:'linked',userId:'native-id',login:'native-login'}};
const mode={...actor,impersonation:{id:'mode',adminId:'admin',adminName:'Admin'}};
assert.equal(hasOktellLink(actor),true);assert.equal(hasOktellLink(mode),false);
for(const path of ['/api/telephony','/api/telephony/numbers','/api/oktell-phone','/api/oktell-pilot','/api/oktell-delivery','/api/operator-state']){
 assert.equal(impersonationBlocksPhone(mode,path),true);
 for(const role of ['operator','department_head','admin','logistic','courier'])for(const method of ['GET','POST','PATCH'])assert.equal(mayCallEndpoint({...mode,role},new URL('https://test'+path),method,{}),false);
 assert.equal(impersonationBlocksPhone(actor,path),false);
}
assert.equal(mayCallEndpoint(mode,new URL('https://test/api/crm'),'GET',{}),mayCallEndpoint(actor,new URL('https://test/api/crm'),'GET',{}));
assert.equal(impersonationBlocksPhone(mode,'/api/call-history'),false,'History remains available with normal role rights');
console.log('Impersonation disables phone routes and native link without changing the employee or ordinary data rights');
