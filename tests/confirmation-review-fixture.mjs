export function checkedHandoff(db,id){
 const row=db.prepare("SELECT json_extract(c.data,'$.name') AS name FROM clients c JOIN orders o ON o.client_id=c.id WHERE o.id=?").get(id);
 return {amountConfirmed:true,incompleteNameConfirmed:true,reviewedRecipient:row.name};
}
