export const normalizeOrderSearch=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
export const isArchiveOrderNumber=(value:string)=>value.length<=100 && /^(?:[a-z0-9]+-)*\d+$/i.test(value);
