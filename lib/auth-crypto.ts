import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export function validatePassword(password:unknown):asserts password is string {
 if(typeof password!=='string'||password.length<12||password.length>128)throw Error('Пароль: от 12 до 128 символов');
}
export async function hashPassword(password:string){
 validatePassword(password);const salt=randomBytes(16).toString('hex');
 const key=await derive(password,salt,64) as Buffer;
 return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string){
 const [method,salt,hash]=encoded.split(':');
 if(method!=='scrypt'||!salt||!hash||password.length>128)return false;
 const key=await derive(password,salt,64) as Buffer;const expected=Buffer.from(hash,'hex');
 return key.length===expected.length&&timingSafeEqual(key,expected);
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(32).toString('hex');
