import {db,auth} from './firebase.js';
import {collection,addDoc,doc,getDoc,getDocs,updateDoc,deleteDoc,query,orderBy,serverTimestamp,writeBatch,setDoc} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
const col=()=>collection(db,'users',auth.currentUser.uid,'links');
const pubRef=id=>doc(db,'publicProfiles',window.__linkoraUsername||'_unpublished','links',id);
async function mirror(id,data){if(!window.__linkoraUsername)return;await setDoc(pubRef(id),{title:data.title||'',url:data.url||'',icon:data.icon||'↗',enabled:data.enabled!==false,order:data.order||0,updatedAt:serverTimestamp()});}
export async function listLinks(){const snap=await getDocs(query(col(),orderBy('order')));return snap.docs.map(x=>({id:x.id,...x.data()}));}
export async function addLink(item){const links=await listLinks();const data={...item,enabled:true,order:links.length,clicks:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};const ref=await addDoc(col(),data);await mirror(ref.id,data);return ref;}
export async function editLink(id,data){await updateDoc(doc(db,'users',auth.currentUser.uid,'links',id),{...data,updatedAt:serverTimestamp()});const old=(await getDoc(doc(db,'users',auth.currentUser.uid,'links',id))).data();await mirror(id,old);}
export async function removeLink(id){await deleteDoc(doc(db,'users',auth.currentUser.uid,'links',id));if(window.__linkoraUsername)await deleteDoc(pubRef(id));}
export async function reorderLinks(items){const batch=writeBatch(db);items.forEach((item,i)=>batch.update(doc(db,'users',auth.currentUser.uid,'links',item.id),{order:i,updatedAt:serverTimestamp()}));await batch.commit();for(let i=0;i<items.length;i++)await mirror(items[i].id,{...items[i],order:i});}
